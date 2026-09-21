import { createHash } from "node:crypto";
import type { TestCase } from "../types";
import { firstArray, resultJson, resultText } from "../result-json";

/**
 * D15 (smoke row D15, tier 2): an attachment saved to Drive is THE SAME
 * BYTES.
 *
 * Guards SCRUM-289, which rewrites the save path from decode-to-temp-file
 * then upload into a streamed decode piped into a multipart upload. A
 * rewrite of a byte path is exactly where a truncation or an encoding slip
 * hides: the file arrives, it opens, and it is subtly not the original.
 *
 * TWO INDEPENDENT SOURCES, ONE BYTE IDENTITY. Size from the Gmail part list
 * against size from Drive, and then the attachment's own bytes fetched
 * separately, decoded here, and md5'd against the checksum Drive computed.
 * Comparing Drive to itself would pass on any consistent corruption.
 *
 * Everything it reads is ours and it reads only: the one write is the save,
 * which this case deletes.
 */
export const d15AttachmentBytes: TestCase = {
  id: "D15",
  title: "an attachment saved to Drive matches the original in size and md5",
  tier: 2,
  covers: [
    "gws-mcp__gmail_search",
    "gws-mcp__gmail_read",
    "gws-mcp__gmail_save_attachment_to_drive",
    "gws-mcp__drive_search",
    "gws-mcp__gws_run",
  ],
  accounts: ["sender"],
  fixtures: ["folder"],
  run: async (ctx) => {
    const found = await ctx.call(
      "gws-mcp__gmail_search",
      { query: "has:attachment smaller:1M", max_results: 5 },
      { as: "sender" }
    );
    const candidates = (firstArray(resultJson("gmail_search", found)) ?? []) as { id?: string }[];
    if (candidates.length === 0) throw new Error("no message with an attachment is available to test");

    // The first message that really carries an attachment part with an id.
    let messageId: string | undefined;
    let part: { attachmentId?: string; filename?: string; size?: number } | undefined;
    for (const candidate of candidates) {
      if (!candidate.id) continue;
      const read = await ctx.call("gws-mcp__gmail_read", { message_id: candidate.id }, { as: "sender" });
      const body = resultJson<{ attachments?: { attachmentId?: string; filename?: string; size?: number }[] }>(
        "gmail_read",
        read
      );
      const withId = (body.attachments ?? []).find((a) => a.attachmentId && (a.size ?? 0) > 0);
      if (withId) {
        messageId = candidate.id;
        part = withId;
        break;
      }
    }
    if (!messageId || !part?.attachmentId) {
      throw new Error("none of the candidate messages exposes an attachment with an id and a size");
    }
    ctx.evidence(`the source attachment is ${part.size} bytes according to Gmail`);

    const saved = await ctx.call(
      "gws-mcp__gmail_save_attachment_to_drive",
      {
        message_id: messageId,
        attachment_id: part.attachmentId,
        filename: `[smoke] D15 ${ctx.stamp}`,
        // `parent_folder_id`, not `folder_id`: the wrong name is accepted
        // silently and the file lands in My Drive root instead of the
        // fixture folder, which is a containment miss nothing would report.
        parent_folder_id: ctx.fixture("folder"),
      },
      { as: "sender" }
    );
    if (saved.isError) throw new Error(`the save failed: ${resultText(saved).slice(0, 200)}`);
    const fileId = resultJson<{ id?: string; fileId?: string }>("gmail_save_attachment_to_drive", saved).id
      ?? resultJson<{ fileId?: string }>("gmail_save_attachment_to_drive", saved).fileId;
    if (!fileId) throw new Error("the save returned no file id, so nothing can be verified or cleaned up");

    ctx.defer("delete the saved attachment", async () => {
      await ctx.call("gws-mcp__docs_delete", { document_id: fileId }, { as: "sender" });
    });

    const meta = resultJson<{ size?: string | number; md5Checksum?: string }>(
      "gws_run",
      await ctx.call(
        "gws-mcp__gws_run",
        {
          service: "drive",
          resource: "files",
          method: "get",
          params: { fileId, fields: "id,size,md5Checksum" },
        },
        { as: "sender" }
      )
    );
    const driveSize = Number(meta.size ?? NaN);
    ctx.evidence(`Drive reports ${driveSize} bytes`);
    if (driveSize !== part.size) {
      throw new Error(`the saved file is ${driveSize} bytes where the attachment is ${part.size}`);
    }
    if (!meta.md5Checksum) throw new Error("Drive returned no md5 for the saved file, so identity cannot be checked");

    // THE SECOND, INDEPENDENT SOURCE: the attachment's own bytes.
    const raw = resultJson<{ data?: string }>(
      "gws_run",
      await ctx.call(
        "gws-mcp__gws_run",
        {
          service: "gmail",
          resource: "users.messages.attachments",
          method: "get",
          params: { userId: "me", messageId, id: part.attachmentId },
        },
        { as: "sender" }
      )
    );
    if (!raw.data) throw new Error("the attachment fetch returned no data to compare");
    const bytes = Buffer.from(raw.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const md5 = createHash("md5").update(bytes).digest("hex");
    ctx.evidence(`decoded ${bytes.length} bytes locally; md5 agrees with Drive: ${md5 === meta.md5Checksum}`);

    if (md5 !== meta.md5Checksum) {
      throw new Error("the bytes in Drive are not the bytes in the mailbox, so the save path corrupts the file");
    }
  },
};
