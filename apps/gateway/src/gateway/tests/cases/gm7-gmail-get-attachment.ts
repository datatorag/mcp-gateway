import type { TestCase } from "../types";
import { resultJson, resultText } from "../result-json";

type Listed = { partId?: string; filename?: string; mimeType?: string; size?: number };

/**
 * GM7 (Gmail scenario): `gmail_get_attachment` on the standing large
 * attachment says how big it is and returns no content.
 *
 * This is the failure the tool was written for. Fetching that attachment
 * through the raw API tool answered with an error about the response being
 * too large, after the bytes had already been pulled, and told the caller
 * nothing it could act on. The fixture is over 5 MiB, so the dedicated
 * tool has to decline it, and the step holds it to four things: the size
 * it states is the size `gmail_read` lists for that part, nothing that
 * looks like content came back, the answer is small, and it names the
 * save-to-Drive route with an attachment id to use there.
 *
 * WHAT THIS STEP DOES NOT SHOW: the text path. No standing fixture carries
 * a small text attachment, so a text attachment returned as text is held
 * by the plugin's own tests and not by a live call.
 *
 * Read-only: nothing is saved and nothing in the mailbox changes.
 */
export const gm7GmailGetAttachment: TestCase = {
  id: "GM7",
  title: "an attachment too large to return is described with its size, and no content comes back",
  covers: ["gws-mcp__gmail_get_attachment", "gws-mcp__gmail_read"],
  accounts: ["reader"],
  fixtures: ["attachmentMessage"],
  run: async (ctx) => {
    const message_id = ctx.fixture("attachmentMessage");

    const read = await ctx.call("gws-mcp__gmail_read", { message_id, text_only: true }, { as: "reader" });
    if (read.isError) throw new Error(`the fixture message could not be read: ${resultText(read).slice(0, 200)}`);
    const part = (resultJson<{ attachments?: Listed[] }>("gmail_read", read).attachments ?? []).find(
      (a) => typeof a.partId === "string" && a.partId !== "" && typeof a.size === "number" && a.size > 5 * 1024 * 1024
    );
    if (!part) {
      throw new Error("the fixture message lists no attachment over 5 MiB with a part id, so the size guard is not exercised");
    }
    ctx.evidence(`gmail_read lists an attachment of ${part.size} bytes at part ${part.partId}`);

    const answered = await ctx.call(
      "gws-mcp__gmail_get_attachment",
      { message_id, part_id: part.partId as string },
      { as: "reader" }
    );
    if (answered.isError) {
      throw new Error(`a large attachment answered as an error where it should be described: ${resultText(answered).slice(0, 200)}`);
    }
    const body = resultJson<{
      size?: number;
      mimeType?: string;
      filename?: string;
      attachment_id?: string;
      content_returned?: boolean;
      reason?: string;
      save_to_drive?: { tool?: string; attachment_id?: string };
      text?: unknown;
      data?: unknown;
    }>("gmail_get_attachment", answered);

    const answerBytes = resultText(answered).length;
    ctx.evidence(`the answer is ${answerBytes} characters, content_returned=${String(body.content_returned)}, states ${body.size} bytes`);

    if (body.size !== part.size) {
      throw new Error("the size the tool states is not the size gmail_read lists for that part, so it may describe another part");
    }
    if (body.content_returned !== false || body.text !== undefined || body.data !== undefined) {
      throw new Error("content came back for an attachment over the limit");
    }
    // The whole answer is a description. A megabyte-sized answer would mean
    // the bytes rode along under some other key.
    if (answerBytes > 4_000) throw new Error(`the answer is ${answerBytes} characters, far more than a description needs`);
    if (!body.reason || !body.reason.includes(Number(part.size).toLocaleString("en-US"))) {
      throw new Error("the reason given does not state the attachment's size");
    }
    if (!body.filename || !body.mimeType) throw new Error("the description carries no file name or no type");
    if (
      body.save_to_drive?.tool !== "gmail_save_attachment_to_drive" ||
      !body.save_to_drive.attachment_id ||
      body.save_to_drive.attachment_id !== body.attachment_id
    ) {
      throw new Error("the answer does not name the save-to-Drive route with the attachment id to use there");
    }
  },
};
