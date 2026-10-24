import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { contentFile } from "../content-file";
import { putThroughLink, uploadPath, uploadThroughLink } from "../upload-link";

/**
 * FD14 (Drive scenario, SCRUM-437): an uploaded file goes to one call. Used
 * once, a second call naming it is refused and sends nothing; the link
 * itself takes no second file.
 */
export const fd14UploadSecondUse: TestCase = {
  id: "FD14",
  title: "an uploaded file goes to one call, and its link takes one file",
  covers: ["file_upload_link", "gws-mcp__drive_upload_file", "gws-mcp__drive_trash_file"],
  accounts: ["sender"],
  fixtures: ["folder"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const file = contentFile();
    const path = uploadPath(await ctx.call("file_upload_link", {}));
    const first = await putThroughLink(ctx, path, { bytes: file.bytes, name: `fd14-${ctx.stamp}.png` });
    const upload_id = first.receipt?.reference?.upload_id;
    if (first.status !== 200 || typeof upload_id !== "string") throw new Error("the upload was refused");
    const second = await putThroughLink(ctx, path, { bytes: file.bytes, name: "again.png" });
    ctx.evidence(`a second file on the link answered ${second.status}`);
    if (second.status !== 410) throw new Error("the link took a second file");

    const used = resultJson<{ file?: { id?: string | null } }>(
      "drive_upload_file",
      await ctx.call("gws-mcp__drive_upload_file", { file: { type: "upload", upload_id }, folder_id: ctx.fixture("folder") }, { as: "sender" })
    );
    const file_id = used.file?.id;
    if (typeof file_id === "string") {
      ctx.defer("trash the uploaded file", async () => {
        const res = await ctx.call("gws-mcp__drive_trash_file", { file_id }, { as: "sender" });
        if (res.isError) ctx.evidence("RESIDUE: the uploaded file could not be trashed");
      });
    } else throw new Error("the first use answered no file id");

    const again = await ctx.call("gws-mcp__drive_upload_file", { file: { type: "upload", upload_id }, folder_id: ctx.fixture("folder") }, { as: "sender" });
    const text = again.content.map((c) => c.text ?? "").join(" ");
    ctx.evidence(`a second use was refused: ${again.isError === true}`);
    if (again.isError !== true || !text.includes("already been used")) throw new Error("an uploaded file was used twice");
  },
};
