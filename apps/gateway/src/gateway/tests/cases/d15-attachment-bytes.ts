import type { TestCase } from "../types";
import { resultJson, resultText } from "../result-json";

/**
 * D15 (smoke row D15): an attachment saved to Drive is THE SAME
 * BYTES.
 *
 * Guards SCRUM-289, which rewrites the save path from decode-to-temp-file
 * then upload into a streamed decode piped into a multipart upload. A
 * rewrite of a byte path is exactly where a truncation or an encoding slip
 * hides: the file arrives, it opens, and it is subtly not the original.
 *
 * THE ATTACHMENT IS A FIXTURE, OVER 5 MiB, sent by hand. A search for
 * "any message with an attachment" tested whatever the mailbox happened to
 * hold, which on a test account is nothing, and a small file never reaches
 * the part of a streamed path that a large one does.
 *
 * TWO INDEPENDENT SOURCES, ONE BYTE IDENTITY. Size from the Gmail part list
 * against size from Drive, and Drive's md5 against the md5 of the ORIGINAL
 * FILE, computed before it was sent and held as a fixture key. The earlier
 * second source fetched the attachment back through `gws_run` and hashed
 * it here; at this size that response is cut at 900 KB, so it would hash a
 * prefix and fail on a correct save. Comparing Drive to itself would pass
 * on any consistent corruption, which is why the md5 comes from outside.
 *
 * Everything it reads is ours and it reads only: the one write is the save,
 * which this case deletes.
 */
export const d15AttachmentBytes: TestCase = {
  id: "D15",
  title: "an attachment saved to Drive matches the original in size and md5",
  covers: [
    "gws-mcp__gmail_read",
    "gws-mcp__gmail_save_attachment_to_drive",
    // Drive metadata comes through gws_run, not drive_search: the size and
    // the checksum are fields drive_search does not return.
    "gws-mcp__gws_run",
    "gws-mcp__docs_delete",
  ],
  accounts: ["reader"],
  fixtures: ["folder", "attachmentMessage", "attachmentMd5"],
  run: async (ctx) => {
    const messageId = ctx.fixture("attachmentMessage");
    const expectedMd5 = ctx.fixture("attachmentMd5").toLowerCase();

    /* `text_only`, because only the flattened view lists attachments. The
     * raw resource carries them as parts, and reading `attachments` off it
     * found nothing, which run 2 reported as a message without them. */
    const read = await ctx.call(
      "gws-mcp__gmail_read",
      { message_id: messageId, text_only: true },
      { as: "reader" }
    );
    if (read.isError) throw new Error(`the fixture message could not be read: ${resultText(read).slice(0, 200)}`);
    const body = resultJson<{ attachments?: { attachmentId?: string; filename?: string; size?: number }[] }>(
      "gmail_read",
      read
    );
    if (!Array.isArray(body.attachments)) {
      throw new Error("gmail_read returned no attachments list for the fixture message, so its shape was not read");
    }
    const withId = body.attachments.filter((a) => a && a.attachmentId && (a.size ?? 0) > 0);
    if (withId.length !== 1) {
      throw new Error(
        `the fixture message carries ${withId.length} attachments with an id and a size, where it should carry exactly one`
      );
    }
    const part = withId[0];
    ctx.evidence(`the source attachment is ${part.size} bytes according to Gmail`);
    if ((part.size ?? 0) <= 5 * 1024 * 1024) {
      throw new Error(`the fixture attachment is ${part.size} bytes, not over 5 MiB, so the large path is not exercised`);
    }

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
      { as: "reader" }
    );
    if (saved.isError) throw new Error(`the save failed: ${resultText(saved).slice(0, 200)}`);
    const fileId = resultJson<{ id?: string; fileId?: string }>("gmail_save_attachment_to_drive", saved).id
      ?? resultJson<{ fileId?: string }>("gmail_save_attachment_to_drive", saved).fileId;
    if (!fileId) throw new Error("the save returned no file id, so nothing can be verified or cleaned up");

    ctx.defer("delete the saved attachment", async () => {
      await ctx.call("gws-mcp__docs_delete", { document_id: fileId }, { as: "reader" });
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
        { as: "reader" }
      )
    );
    const driveSize = Number(meta.size ?? NaN);
    ctx.evidence(`Drive reports ${driveSize} bytes`);
    if (driveSize !== part.size) {
      throw new Error(`the saved file is ${driveSize} bytes where the attachment is ${part.size}`);
    }
    if (!meta.md5Checksum) throw new Error("Drive returned no md5 for the saved file, so identity cannot be checked");

    ctx.evidence(`Drive's md5 agrees with the original file's: ${meta.md5Checksum.toLowerCase() === expectedMd5}`);
    if (meta.md5Checksum.toLowerCase() !== expectedMd5) {
      throw new Error("the bytes in Drive are not the bytes of the original file, so the save path corrupts it");
    }
  },
};
