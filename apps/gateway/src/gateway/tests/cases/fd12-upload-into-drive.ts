import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { contentFile } from "../content-file";
import { uploadThroughLink } from "../upload-link";

type Upload = { file?: { id?: string | null }; sent?: { bytes?: number; sha256?: string }; checksum_match?: boolean | null };

/**
 * FD12 (Drive scenario, SCRUM-437): a file sent through an upload link, the
 * way the receipt's curl command sends it, is put into the fixture folder by
 * its upload reference, and Drive's own checksum of what it stored is the
 * hash of the bytes the case sent. The file is trashed at the end.
 */
export const fd12UploadIntoDrive: TestCase = {
  id: "FD12",
  title: "a file sent through an upload link lands in Drive as the bytes that were sent",
  covers: ["file_upload_link", "gws-mcp__drive_upload_file", "gws-mcp__drive_trash_file"],
  accounts: ["sender"],
  fixtures: ["folder"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const file = contentFile();
    const { upload_id } = await uploadThroughLink(ctx, await ctx.call("file_upload_link", {}), { ...file, name: `fd12-${ctx.stamp}.png` });
    const receipt = resultJson<Upload>(
      "drive_upload_file",
      await ctx.call(
        "gws-mcp__drive_upload_file",
        { file: { type: "upload", upload_id }, folder_id: ctx.fixture("folder") },
        { as: "sender" }
      )
    );
    const file_id = receipt.file?.id;
    if (typeof file_id !== "string") throw new Error("drive_upload_file answered no file id");
    ctx.defer("trash the uploaded file", async () => {
      const res = await ctx.call("gws-mcp__drive_trash_file", { file_id }, { as: "sender" });
      if (res.isError) ctx.evidence("RESIDUE: the uploaded file could not be trashed");
    });
    ctx.evidence(`sent hash is the case's: ${receipt.sent?.sha256 === file.sha256}; Drive's checksum matches: ${receipt.checksum_match}`);
    if (receipt.sent?.sha256 !== file.sha256) throw new Error("what reached Drive is not the file the case uploaded");
    if (receipt.checksum_match !== true) throw new Error("Drive's checksum of what it stored does not match what was sent");
  },
};
