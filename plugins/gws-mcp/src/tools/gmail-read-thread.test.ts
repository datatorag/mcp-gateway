import { describe, expect, it } from "vitest";
import { handleGmail, THREAD_BODY_BUDGET_CHARS } from "./gmail.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";

/* SCRUM-491: a whole Gmail conversation by its thread id, in one call. Every
 * message in the order it was received, each in the shape gmail_read's text
 * view gives; a light depth with headers and snippet only; bodies held to a
 * stated total, with what was left out named rather than cut silently. */

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function message(id: string, at: number, body: string, labelIds: string[] = ["INBOX"]) {
  return {
    id,
    threadId: "t1",
    internalDate: String(at),
    labelIds,
    snippet: `snippet of ${id}`,
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: `${id}@example.com` },
        { name: "To", value: "reader@example.com" },
        { name: "Cc", value: "cc@example.com" },
        { name: "Subject", value: "Re: plans" },
        { name: "Date", value: new Date(at).toUTCString() },
      ],
      parts: [
        { partId: "0", mimeType: "text/plain", body: { data: b64(body) } },
        { partId: "1", mimeType: "application/pdf", filename: `${id}.pdf`, body: { attachmentId: `att-${id}`, size: 10 } },
      ],
    },
  };
}

type Row = Record<string, unknown> & { id: string; body?: string | null };
const rows = (res: Parameters<typeof payload>[0]) => payload(res).messages as Row[];

describe("gmail_read_thread", () => {
  it("answers every message oldest to newest, whatever order Gmail sent them in", async () => {
    const { client, calls } = fakeClient([
      { data: { id: "t1", messages: [message("m3", 3000, "third"), message("m1", 1000, "first"), message("m2", 2000, "second")] } },
    ]);
    const res = await handleGmail(client, "gmail_read_thread", { thread_id: "t1" });
    expect(calls[0]).toMatchObject({ resource: "users.threads", method: "get", params: { userId: "me", id: "t1", format: "full" } });
    expect(payload(res)).toMatchObject({ thread_id: "t1", depth: "full", message_count: 3 });
    expect(rows(res).map((r) => r.id)).toEqual(["m1", "m2", "m3"]);
    expect(rows(res).map((r) => r.body)).toEqual(["first", "second", "third"]);
  });

  it("gives each message gmail_read's text view: headers, body and attachments by part id", async () => {
    const { client } = fakeClient([{ data: { id: "t1", messages: [message("m1", 1000, "hello")] } }]);
    const [row] = rows(await handleGmail(client, "gmail_read_thread", { thread_id: "t1" }));
    expect(row).toMatchObject({
      id: "m1",
      threadId: "t1",
      from: "m1@example.com",
      to: "reader@example.com",
      cc: "cc@example.com",
      subject: "Re: plans",
      body: "hello",
      is_draft: false,
      in_trash: false,
    });
    expect(row.attachments).toEqual([
      { partId: "1", filename: "m1.pdf", mimeType: "application/pdf", attachmentId: "att-m1", size: 10 },
    ]);
  });

  it("marks a draft and a message in Trash rather than hiding them", async () => {
    const { client } = fakeClient([
      {
        data: {
          id: "t1",
          messages: [message("m1", 1000, "sent", ["SENT", "TRASH"]), message("m2", 2000, "unsent", ["DRAFT"])],
        },
      },
    ]);
    const res = rows(await handleGmail(client, "gmail_read_thread", { thread_id: "t1" }));
    expect(res.map((r) => [r.id, r.in_trash, r.is_draft])).toEqual([
      ["m1", true, false],
      ["m2", false, true],
    ]);
  });

  it("depth headers asks Gmail for metadata and answers headers and snippet, no body", async () => {
    const { client, calls } = fakeClient([{ data: { id: "t1", messages: [message("m1", 1000, "hello")] } }]);
    const res = await handleGmail(client, "gmail_read_thread", { thread_id: "t1", depth: "headers" });
    expect(calls[0]).toMatchObject({ params: { format: "metadata" } });
    const [row] = rows(res);
    expect(row).toMatchObject({ subject: "Re: plans", snippet: "snippet of m1" });
    expect(row).not.toHaveProperty("body");
    expect(row).not.toHaveProperty("attachments");
    expect(payload(res).depth).toBe("headers");
  });

  it("max_body_chars cuts each body, with the marker", async () => {
    const { client } = fakeClient([{ data: { id: "t1", messages: [message("m1", 1000, "x".repeat(50))] } }]);
    const [row] = rows(await handleGmail(client, "gmail_read_thread", { thread_id: "t1", max_body_chars: 10 }));
    expect(row.body).toMatch(/^x{10}\n…\[truncated 40 of 50 chars\]$/);
  });

  describe("a thread longer than the body budget", () => {
    const big = Math.floor(THREAD_BODY_BUDGET_CHARS / 2) - 10;

    it("keeps the newest bodies, leaves the oldest out, and names them with how to read them", async () => {
      const { client } = fakeClient([
        {
          data: {
            id: "t1",
            messages: [
              message("m1", 1000, "a".repeat(big)),
              message("m2", 2000, "b".repeat(big)),
              message("m3", 3000, "c".repeat(big)),
            ],
          },
        },
      ]);
      const res = await handleGmail(client, "gmail_read_thread", { thread_id: "t1" });
      const r = rows(res);
      expect(r.map((x) => x.id)).toEqual(["m1", "m2", "m3"]);
      expect(r[0].body).toBeNull();
      expect(r[0].body_left_out).toBe(true);
      expect(r[1].body).toHaveLength(big);
      expect(r[2].body).toHaveLength(big);
      expect(r[1]).not.toHaveProperty("body_left_out");
      // The headers of a left-out message are still answered.
      expect(r[0].from).toBe("m1@example.com");
      expect(payload(res).left_out).toMatchObject({ message_ids: ["m1"], read_with: expect.stringContaining("gmail_read") });
      expect(String((payload(res).left_out as { reason: string }).reason)).toContain(String(THREAD_BODY_BUDGET_CHARS));
    });

    it("cuts a newest body that is over the budget alone, marked, and leaves every older one out", async () => {
      const { client } = fakeClient([
        {
          data: {
            id: "t1",
            messages: [message("m1", 1000, "short"), message("m2", 2000, "z".repeat(THREAD_BODY_BUDGET_CHARS + 5))],
          },
        },
      ]);
      const res = await handleGmail(client, "gmail_read_thread", { thread_id: "t1" });
      const r = rows(res);
      expect(r[1].body).toContain(`[truncated 5 of ${THREAD_BODY_BUDGET_CHARS + 5} chars]`);
      expect(r[0].body).toBeNull();
      expect(payload(res).left_out).toMatchObject({ message_ids: ["m1"] });
    });

    it("says nothing about leaving out when nothing was", async () => {
      const { client } = fakeClient([{ data: { id: "t1", messages: [message("m1", 1000, "a"), message("m2", 2000, "b")] } }]);
      const res = await handleGmail(client, "gmail_read_thread", { thread_id: "t1" });
      expect(payload(res)).not.toHaveProperty("left_out");
      expect(rows(res).every((r) => !("body_left_out" in r))).toBe(true);
    });
  });
});
