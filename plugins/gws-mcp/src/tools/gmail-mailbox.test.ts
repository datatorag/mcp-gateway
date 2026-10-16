import { describe, expect, it } from "vitest";
import { CREATE, MUTATE, READ } from "./annotations.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";
import {
  ATTACHMENT_TEXT_MAX_BYTES,
  ATTACHMENT_TEXT_MAX_CHARS,
  gmailMailboxTools,
  handleGmailMailbox,
} from "./gmail-mailbox.js";

/* SCRUM-419: four mailbox calls that were only reachable through the raw API
 * tool. The tests are about the request each one sends, and for the
 * attachment tool about what it refuses to fetch and what it never returns. */

const tool = (name: string) => gmailMailboxTools.find((t) => t.name === name)!;
const b64url = (text: string | Uint8Array) => Buffer.from(text).toString("base64url");
/** The attachments.get response body, as the download stream yields it. */
const attachmentBody = (content: string | Uint8Array) => ({ text: JSON.stringify({ data: b64url(content) }) });

const message = (part: Record<string, unknown>) => ({
  data: { payload: { partId: "", mimeType: "multipart/mixed", parts: [{ partId: "0", mimeType: "text/plain", body: { size: 12 } }, part] } },
});

describe("gmail_trash and gmail_untrash", () => {
  it("trash calls users.messages.trash for the one message and reports the state Gmail answered", async () => {
    const { client, calls } = fakeClient([{ data: { id: "m1", threadId: "t1", labelIds: ["TRASH", "CATEGORY_UPDATES"] } }]);
    const result = payload(await handleGmailMailbox(client, "gmail_trash", { message_id: "m1" }));
    expect(calls).toEqual([{ service: "gmail", resource: "users.messages", method: "trash", params: { userId: "me", id: "m1" } }]);
    expect(result).toEqual({ message_id: "m1", thread_id: "t1", in_trash: true, labelIds: ["TRASH", "CATEGORY_UPDATES"] });
  });

  it("untrash calls users.messages.untrash, and in_trash comes from the answer, not from the method", async () => {
    const { client, calls } = fakeClient([{ data: { id: "m1", threadId: "t1", labelIds: ["CATEGORY_UPDATES"] } }]);
    const result = payload(await handleGmailMailbox(client, "gmail_untrash", { message_id: "m1" }));
    expect(calls[0]).toMatchObject({ resource: "users.messages", method: "untrash", params: { userId: "me", id: "m1" } });
    expect(result.in_trash).toBe(false);
    // The control for the line above: a trash call whose answer lacks the
    // label does not get to say the message is in Trash.
    const odd = fakeClient([{ data: { id: "m1", labelIds: [] } }]);
    expect(payload(await handleGmailMailbox(odd.client, "gmail_trash", { message_id: "m1" })).in_trash).toBe(false);
  });

  it("refuses a message id that is not an id, before any request", async () => {
    for (const bad of [undefined, "", "a/b", "me/messages/1", "id with space"]) {
      const { client, calls } = fakeClient([]);
      await expect(handleGmailMailbox(client, "gmail_trash", { message_id: bad })).rejects.toThrow(/message_id/);
      expect(calls).toHaveLength(0);
    }
  });

  it("trash is marked destructive and untrash is not", () => {
    expect(tool("gmail_trash").annotations).toEqual(MUTATE("Move email to Trash"));
    expect(tool("gmail_untrash").annotations).toEqual(CREATE("Restore email from Trash"));
  });
});

describe("gmail_list_drafts", () => {
  it("lists through users.drafts.list with the userId the raw call kept missing", async () => {
    const { client, calls } = fakeClient([
      { data: { drafts: [{ id: "d1", message: { id: "m1", threadId: "t1" } }], nextPageToken: "next", resultSizeEstimate: 9 } },
    ]);
    const result = payload(await handleGmailMailbox(client, "gmail_list_drafts", { query: "subject:invoice", page_token: "p", max_results: 5 }));
    expect(calls).toEqual([
      { service: "gmail", resource: "users.drafts", method: "list", params: { userId: "me", maxResults: 5, q: "subject:invoice", pageToken: "p" } },
    ]);
    expect(result).toEqual({ count: 1, drafts: [{ draft_id: "d1", message_id: "m1", thread_id: "t1" }], nextPageToken: "next" });
  });

  it("a mailbox with no drafts answers an empty list, whatever shape Gmail's nothing takes", async () => {
    for (const nothing of [{}, "", undefined, { resultSizeEstimate: 0 }]) {
      const { client, calls } = fakeClient([{ data: nothing }]);
      expect(payload(await handleGmailMailbox(client, "gmail_list_drafts", {}))).toEqual({ count: 0, drafts: [] });
      expect(calls[0].params).toEqual({ userId: "me", maxResults: 20 });
    }
  });

  it("asks Gmail for a page it can give: at least 1, at most 500, a whole number", async () => {
    for (const [asked, sent] of [[5000, 500], [0, 20], [-3, 1], [2.9, 2], ["many", 20]] as const) {
      const { client, calls } = fakeClient([{ data: {} }]);
      await handleGmailMailbox(client, "gmail_list_drafts", { max_results: asked });
      expect((calls[0].params as { maxResults: number }).maxResults, String(asked)).toBe(sent);
    }
  });

  it("is a read", () => {
    expect(tool("gmail_list_drafts").annotations).toEqual(READ("List email drafts"));
  });
});

describe("gmail_get_attachment", () => {
  const csv = { partId: "1", filename: "report.csv", mimeType: "text/csv", body: { attachmentId: "att-fresh", size: 11 } };

  it("returns a text attachment as text, with its name, type, size and a current attachment id", async () => {
    const { client, calls } = fakeClient([message(csv), attachmentBody("a,b\n1,2\n")]);
    const result = payload(await handleGmailMailbox(client, "gmail_get_attachment", { message_id: "m1", part_id: "1" }));
    expect(calls[0]).toMatchObject({ service: "gmail", resource: "users.messages", method: "get", params: { userId: "me", id: "m1", format: "full" } });
    // The bytes are asked for with the id THIS read returned.
    expect(calls[1]).toEqual({
      download: true,
      service: "gmail",
      resource: "users.messages.attachments",
      method: "get",
      params: { userId: "me", messageId: "m1", id: "att-fresh", fields: "data" },
    });
    expect(result).toEqual({
      message_id: "m1",
      part_id: "1",
      filename: "report.csv",
      mimeType: "text/csv",
      size: 8,
      attachment_id: "att-fresh",
      content_returned: true,
      truncated: false,
      text_origin: "attachment content, supplied by the sender of the message",
      text: "a,b\n1,2\n",
    });
  });

  it("never fetches a non-text attachment: it says what it is, how big, and how to save it", async () => {
    const pdf = { partId: "1", filename: "contract.pdf", mimeType: "application/pdf", body: { attachmentId: "att-pdf", size: 10_485_761 } };
    const { client, calls } = fakeClient([message(pdf)]);
    const result = payload(await handleGmailMailbox(client, "gmail_get_attachment", { message_id: "m1", part_id: "1" }));
    expect(calls).toHaveLength(1);
    expect(result.content_returned).toBe(false);
    expect(result.reason).toContain("application/pdf");
    expect(result.reason).toContain("10,485,761 bytes");
    expect(result.save_to_drive).toEqual({
      tool: "gmail_save_attachment_to_drive",
      message_id: "m1",
      attachment_id: "att-pdf",
      filename: "contract.pdf",
    });
    expect(result).not.toHaveProperty("text");
    expect(result).not.toHaveProperty("data");
  });

  it("states the size of a text attachment over the limit before refusing, and fetches nothing", async () => {
    const big = { ...csv, body: { attachmentId: "att-big", size: ATTACHMENT_TEXT_MAX_BYTES + 1 } };
    const { client, calls } = fakeClient([message(big)]);
    const result = payload(await handleGmailMailbox(client, "gmail_get_attachment", { message_id: "m1", part_id: "1" }));
    expect(calls).toHaveLength(1);
    expect(result.content_returned).toBe(false);
    expect(result.reason).toContain(`${(ATTACHMENT_TEXT_MAX_BYTES + 1).toLocaleString("en-US")} bytes`);
    expect(result.save_to_drive.attachment_id).toBe("att-big");
  });

  it("an attachment exactly at the limit is returned: the limit is inclusive", async () => {
    const atLimit = { ...csv, body: { attachmentId: "att-ok", size: ATTACHMENT_TEXT_MAX_BYTES } };
    const { client } = fakeClient([message(atLimit), attachmentBody("x".repeat(100))]);
    expect(payload(await handleGmailMailbox(client, "gmail_get_attachment", { message_id: "m1", part_id: "1" })).content_returned).toBe(true);
  });

  it("stops when Gmail sends more than it declared: the declared size is not a promise", async () => {
    const { client } = fakeClient([message(csv), attachmentBody("x".repeat(ATTACHMENT_TEXT_MAX_BYTES + 10))]);
    const result = payload(await handleGmailMailbox(client, "gmail_get_attachment", { message_id: "m1", part_id: "1" }));
    expect(result.content_returned).toBe(false);
    expect(result).not.toHaveProperty("text");
  });

  it("cuts long text with a marker, and the response stays well under the transport's ceiling", async () => {
    const long = "é".repeat(ATTACHMENT_TEXT_MAX_CHARS + 500);
    const { client } = fakeClient([message(csv), attachmentBody(long)]);
    const response = await handleGmailMailbox(client, "gmail_get_attachment", { message_id: "m1", part_id: "1" });
    const result = payload(response);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("[truncated 500 of");
    // Valid JSON end to end: the size cap never cut the envelope itself.
    expect(response.content[0].text.length).toBeLessThan(900_000);
  });

  it("control characters do not ride into the response, where each would cost six characters", async () => {
    const { client } = fakeClient([message(csv), attachmentBody(new Uint8Array([0x61, 0x00, 0x07, 0x1b, 0x62, 0x0a, 0x09, 0x63]))]);
    expect(payload(await handleGmailMailbox(client, "gmail_get_attachment", { message_id: "m1", part_id: "1" })).text).toBe("a   b\n\tc");
  });

  it("characters a reader cannot see are removed, so the text reads the same to a person and to a model", async () => {
    const hidden = "pay\u200b the\u202e invoice\u2066 now\ufeff\u{e0041}\u{e007f} please\u200d";
    const { client } = fakeClient([message(csv), attachmentBody(hidden)]);
    expect(payload(await handleGmailMailbox(client, "gmail_get_attachment", { message_id: "m1", part_id: "1" })).text).toBe(
      "pay the invoice now please"
    );
  });

  it("an emoji outside the removed ranges survives, so the surrogate half of the pattern is not too wide", async () => {
    const { client } = fakeClient([message(csv), attachmentBody("ok \u{1f600} \u{e0100}")]);
    expect(payload(await handleGmailMailbox(client, "gmail_get_attachment", { message_id: "m1", part_id: "1" })).text).toBe(
      "ok \u{1f600} \u{e0100}"
    );
  });

  it("bytes that are not UTF-8 come back as text with replacement characters, never as an exception", async () => {
    const { client } = fakeClient([message(csv), attachmentBody(new Uint8Array([0x61, 0xff, 0xfe, 0x62]))]);
    const result = payload(await handleGmailMailbox(client, "gmail_get_attachment", { message_id: "m1", part_id: "1" }));
    expect(result.text).toBe("a��b");
  });

  it("the sender's file name and type are cleaned before they are returned", async () => {
    const hostile = {
      partId: "1",
      filename: "in\u202evoice\r\nX-Injected: 1/..\\evil.csv",
      mimeType: "text/csv; charset=utf-8\r\nX: y",
      body: { attachmentId: "att-1", size: 4 },
    };
    const { client, calls } = fakeClient([message(hostile)]);
    const result = payload(await handleGmailMailbox(client, "gmail_get_attachment", { message_id: "m1", part_id: "1" }));
    expect(result.filename).not.toMatch(/[\r\n\u202e/\\]/);
    // A type that is not a bare type/subtype is not believed, so it is not
    // text, so nothing is fetched.
    expect(result.mimeType).toBe("application/octet-stream");
    expect(result.content_returned).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("a part that is not an attachment, or does not exist, is an error naming the part", async () => {
    for (const partId of ["0", "7"]) {
      const { client, calls } = fakeClient([message(csv)]);
      await expect(handleGmailMailbox(client, "gmail_get_attachment", { message_id: "m1", part_id: partId })).rejects.toThrow(
        `has no attachment at part ${partId}`
      );
      expect(calls).toHaveLength(1);
    }
  });

  it("refuses a part id or message id that is not one, before any request", async () => {
    for (const args of [
      { message_id: "m1", part_id: "ANGjdJ8-attachment-id" },
      { message_id: "m1", part_id: "1/../2" },
      { message_id: "m1" },
      { message_id: "m/1", part_id: "1" },
    ]) {
      const { client, calls } = fakeClient([]);
      await expect(handleGmailMailbox(client, "gmail_get_attachment", args)).rejects.toThrow(/part_id|message_id/);
      expect(calls).toHaveLength(0);
    }
  });

  it("is a read, and its description says bytes are not returned", () => {
    expect(tool("gmail_get_attachment").annotations).toEqual(READ("Read an email attachment"));
    expect(tool("gmail_get_attachment").description).toContain("File bytes are not returned as base64 for any type.");
  });
});
