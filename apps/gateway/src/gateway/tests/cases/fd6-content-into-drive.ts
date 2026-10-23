import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { contentFile } from "../content-file";

type Upload = {
  file?: { id?: string | null; name?: string | null };
  sent?: { bytes?: number; sha256?: string };
  checksum_match?: boolean | null;
};

/**
 * FD6 (Drive scenario, SCRUM-437): a file the caller already holds, sent as a
 * `content` reference, lands in the fixture folder, and Drive's own checksum
 * of what it stored is the hash of the bytes the case sent.
 *
 * The independent check is Drive's: `checksum_match` compares the SHA-256
 * Drive computed with the one sent, and the case compares the one sent with
 * its own. The file is trashed at the end.
 */
export const fd6ContentIntoDrive: TestCase = {
  id: "FD6",
  title: "a file sent as a content reference lands in Drive as the bytes that were sent",
  covers: ["gws-mcp__drive_upload_file", "gws-mcp__drive_trash_file"],
  accounts: ["sender"],
  fixtures: ["folder"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const file = contentFile();
    const receipt = resultJson<Upload>(
      "drive_upload_file",
      await ctx.call(
        "gws-mcp__drive_upload_file",
        {
          file: { type: "content", name: `fd6-${ctx.stamp}.png`, mime_type: "image/png", base64: file.base64 },
          folder_id: ctx.fixture("folder"),
        },
        { as: "sender" }
      )
    );
    const file_id = receipt.file?.id;
    if (typeof file_id !== "string") throw new Error("drive_upload_file answered no file id");
    ctx.defer("trash the uploaded file", async () => {
      const res = await ctx.call("gws-mcp__drive_trash_file", { file_id }, { as: "sender" });
      if (res.isError) ctx.evidence("RESIDUE: the uploaded file could not be trashed");
    });
    ctx.evidence(
      `${receipt.sent?.bytes} bytes sent; their SHA-256 is the case's: ${receipt.sent?.sha256 === file.sha256}; Drive's checksum matches: ${receipt.checksum_match}`
    );
    if (receipt.sent?.bytes !== file.bytes.length) throw new Error("the receipt's byte count is not the size of the file sent");
    if (receipt.sent?.sha256 !== file.sha256) throw new Error("what reached Drive is not the file the case sent");
    if (receipt.checksum_match !== true) throw new Error("Drive's checksum of what it stored does not match what was sent");
  },
};
