import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { saveThroughLink } from "../drive-reference";

type Attachment = { partId?: string; size?: number };
type Upload = { file?: { id?: string | null }; sent?: { bytes?: number; sha256?: string }; checksum_match?: boolean | null };

/**
 * FD3 (Drive scenario, SCRUM-428): a Drive file as stored, named by a
 * `drive_file` reference, is saved through a download link, and the bytes
 * that arrive are the file Drive holds.
 *
 * THE FIXTURE IS PLACED HERE, by the fixture accounts' own tools, and checked
 * before it is used: the standing message's attachment is copied from the
 * reader's mailbox into the sender's fixture folder with drive_upload_file,
 * whose receipt carries Drive's own SHA-256 of what it stored. That checksum
 * is the independent one: the link's bytes must hash to it. The copy is
 * trashed at the end.
 *
 * NOTHING ABOUT THE FILE IS WRITTEN DOWN: byte counts and booleans only.
 */
export const fd3DownloadDriveFile: TestCase = {
  id: "FD3",
  title: "a Drive file named by a drive_file reference downloads as the bytes Drive stored",
  covers: ["file_download_link", "gws-mcp__drive_upload_file", "gws-mcp__drive_get_file", "gws-mcp__drive_trash_file", "gws-mcp__gmail_read"],
  accounts: ["reader", "sender"],
  distinctAccounts: true,
  fixtures: ["smokeMessage", "folder"],
  timeoutMs: 150_000,
  run: async (ctx) => {
    const message_id = ctx.fixture("smokeMessage");
    const read = resultJson<{ attachments?: Attachment[] }>(
      "gmail_read",
      await ctx.call("gws-mcp__gmail_read", { message_id, text_only: true, max_body_chars: 1 }, { as: "reader" })
    );
    const part = (read.attachments ?? []).find((a) => typeof a.partId === "string" && a.partId !== "" && (a.size ?? 0) > 0);
    if (!part) throw new Error("the standing fixture message carries no attachment, so there is no file to place in Drive");

    // The setup step: the file this case downloads, placed by the sender.
    const placed = resultJson<Upload>(
      "drive_upload_file",
      await ctx.call(
        "gws-mcp__drive_upload_file",
        { file: { type: "gmail_attachment", message_id, part_id: part.partId, account: ctx.address("reader") }, folder_id: ctx.fixture("folder") },
        { as: "sender" }
      )
    );
    const file_id = placed.file?.id;
    if (typeof file_id !== "string") throw new Error("placing the fixture file answered no file id");
    ctx.defer("trash the placed file", async () => {
      const res = await ctx.call("gws-mcp__drive_trash_file", { file_id }, { as: "sender" });
      if (res.isError) ctx.evidence("RESIDUE: the placed file could not be trashed");
    });
    if (placed.checksum_match !== true) throw new Error("Drive's checksum of the placed file does not match what was sent, so it is no fixture");
    const there = resultJson<{ id?: string; trashed?: boolean }>(
      "drive_get_file",
      await ctx.call("gws-mcp__drive_get_file", { file_id }, { as: "sender" })
    );
    if (there.id !== file_id || there.trashed === true) throw new Error("the placed file is not there to download");

    const saved = await saveThroughLink(
      ctx,
      await ctx.call("file_download_link", { file: { type: "drive_file", file_id, account: ctx.address("sender") } })
    );
    ctx.evidence(`${saved.body.length} bytes arrived as ${saved.type}; they hash to Drive's stored SHA-256: ${saved.sha256 === placed.sent?.sha256}`);
    if (saved.sha256 !== placed.sent?.sha256) throw new Error("the downloaded bytes are not the file Drive stored");
    // A stored file's declared type is its uploader's word; a link sends it opaque.
    if (saved.type !== "application/octet-stream") throw new Error(`a stored Drive file was sent as ${saved.type}, not application/octet-stream`);
  },
};
