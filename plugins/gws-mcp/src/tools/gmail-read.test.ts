import { describe, expect, it } from "vitest";
import { handleGmail } from "./gmail.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";

/* SCRUM-283. The text view flattens a message's text/html part, and that
 * markup is chosen by WHOEVER SENT THE MAIL. Flattening is linear now, but the
 * input is still bounded before any work happens: the only other limit on it
 * is Gmail's ~25MB message cap, and `max_body_chars` truncates the text AFTER
 * extraction so it never reduces the work. */
describe("gmail_read bounds the HTML it flattens", () => {
  const htmlMessage = (html: string) => ({
    data: {
      id: "m1",
      threadId: "t1",
      payload: {
        mimeType: "text/html",
        headers: [{ name: "Subject", value: "hi" }],
        body: { data: Buffer.from(html, "utf8").toString("base64url") },
      },
    },
  });

  it("flattens a normal HTML-only message in full", async () => {
    const { client } = fakeClient([htmlMessage("<p>hello <b>there</b></p>")]);
    const res = await handleGmail(client, "gmail_read", { message_id: "m1", text_only: true });
    expect(payload(res).body).toBe("hello there");
    expect(payload(res).body).not.toContain("truncated");
  });

  it("truncates an oversized HTML part and says so", async () => {
    const huge = "<p>x</p>".repeat(100_000); // ~800KB, over the cap
    const { client } = fakeClient([htmlMessage(huge)]);
    const res = await handleGmail(client, "gmail_read", { message_id: "m1", text_only: true });
    const body = payload(res).body as string;
    expect(body).toContain("chars of HTML before text extraction");
    expect(body).toMatch(/truncated \d+ of \d+/);
  });

  it("does not stall on a hostile HTML part", async () => {
    // Many unclosed tags: the shape that made the old flatten quadratic. One
    // unclosed tag costs nothing either way, so the count is the lever.
    const hostile = "<div ".repeat(Math.ceil((2 * 1024 * 1024) / 5)); // 2MB
    const { client } = fakeClient([htmlMessage(hostile)]);
    const started = Date.now();
    await handleGmail(client, "gmail_read", { message_id: "m1", text_only: true });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("still prefers a text/plain part and never flattens at all", async () => {
    const { client } = fakeClient([
      {
        data: {
          id: "m1",
          payload: {
            mimeType: "multipart/alternative",
            headers: [{ name: "Subject", value: "hi" }],
            parts: [
              { mimeType: "text/plain", body: { data: Buffer.from("plain wins", "utf8").toString("base64url") } },
              { mimeType: "text/html", body: { data: Buffer.from("<p>html loses</p>", "utf8").toString("base64url") } },
            ],
          },
        },
      },
    ]);
    const res = await handleGmail(client, "gmail_read", { message_id: "m1", text_only: true });
    expect(payload(res).body).toBe("plain wins");
  });
});

describe("the HTML cap does not cut through a surrogate pair", () => {
  it("leaves no unpaired surrogate at the cut", async () => {
    // Land an astral character exactly across the 512KB boundary.
    const cap = 512 * 1024;
    const html = "a".repeat(cap - 1) + "\u{1F389}" + "b".repeat(100);
    const { client } = fakeClient([
      {
        data: {
          id: "m1",
          payload: {
            mimeType: "text/html",
            headers: [{ name: "Subject", value: "hi" }],
            body: { data: Buffer.from(html, "utf8").toString("base64url") },
          },
        },
      },
    ]);
    const res = await handleGmail(client, "gmail_read", { message_id: "m1", text_only: true });
    const body = payload(res).body as string;
    // NOT an assertion about U+FFFD: a lone surrogate stays a lone surrogate
    // inside a JS string and only becomes a replacement character when it is
    // ENCODED, so that check passes with or without the guard — it was vacuous
    // until a mutation run showed it green with the guard removed. The round
    // trip through UTF-8 is what actually detects an unpaired half.
    expect(Buffer.from(body, "utf8").toString("utf8")).toBe(body);
    expect(body).toContain("chars of HTML before text extraction");
  });
});

/* SCRUM-289: the tool states WHAT to move; the transport decides how. */
describe("gmail_save_attachment_to_drive", () => {
  it("hands the transfer to the client with the caller's names, and returns the Drive file", async () => {
    const { client, calls } = fakeClient([{ data: { id: "f1", name: "q3.pdf", webViewLink: "https://drive.google.com/file/d/f1/view" } }]);
    const res = await handleGmail(client, "gmail_save_attachment_to_drive", {
      message_id: "m1",
      attachment_id: "a1",
      filename: "q3.pdf",
      parent_folder_id: "folder9",
    });
    expect(calls).toEqual([{ transfer: { messageId: "m1", attachmentId: "a1", name: "q3.pdf", parent: "folder9" } }]);
    expect(payload(res)).toEqual({ id: "f1", name: "q3.pdf", webViewLink: "https://drive.google.com/file/d/f1/view" });
  });

  it("passes no parent when none was given", async () => {
    const { client, calls } = fakeClient([{ data: { id: "f1" } }]);
    await handleGmail(client, "gmail_save_attachment_to_drive", { message_id: "m1", attachment_id: "a1", filename: "a.txt" });
    expect((calls[0].transfer as { parent?: string }).parent).toBeUndefined();
  });
});

/* SCRUM-395: the part id is what a file reference names an attachment by.
 * Gmail issues a new attachmentId on every read; the partId stays put. */
describe("gmail_read lists each attachment with its part id", () => {
  it("carries the partId of every part that has an attachment, however deep", async () => {
    const { client } = fakeClient([
      {
        data: {
          id: "m1",
          payload: {
            partId: "",
            mimeType: "multipart/mixed",
            headers: [{ name: "Subject", value: "hi" }],
            parts: [
              { partId: "0", mimeType: "text/plain", body: { data: Buffer.from("see attached", "utf8").toString("base64url") } },
              {
                partId: "1",
                mimeType: "multipart/mixed",
                parts: [{ partId: "1.0", mimeType: "application/pdf", filename: "q3.pdf", body: { attachmentId: "a1", size: 10 } }],
              },
              { partId: "2", mimeType: "image/png", filename: "chart.png", body: { attachmentId: "a2", size: 20 } },
            ],
          },
        },
      },
    ]);
    const res = await handleGmail(client, "gmail_read", { message_id: "m1", text_only: true });
    expect(payload(res).attachments).toEqual([
      { partId: "1.0", filename: "q3.pdf", mimeType: "application/pdf", attachmentId: "a1", size: 10 },
      { partId: "2", filename: "chart.png", mimeType: "image/png", attachmentId: "a2", size: 20 },
    ]);
  });
});
