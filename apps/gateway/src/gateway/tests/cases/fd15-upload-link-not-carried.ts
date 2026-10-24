import type { TestCase } from "../types";
import { contentFile } from "../content-file";
import { putThroughLink, uploadPath } from "../upload-link";

/**
 * FD15 (SCRUM-437): a call that carries a live upload link is refused and
 * the link is cancelled, so it then takes no file.
 */
export const fd15UploadLinkNotCarried: TestCase = {
  id: "FD15",
  title: "a call that carries a live upload link is refused and the link is cancelled",
  covers: ["file_upload_link", "echo"],
  accounts: ["sender"],
  timeoutMs: 60_000,
  run: async (ctx) => {
    const made = await ctx.call("file_upload_link", {});
    const path = uploadPath(made);
    const url = JSON.parse(made.content[0]?.text ?? "{}").link?.url as string;
    const carried = await ctx.call("echo", { message: `${ctx.stamp} ${url}` });
    ctx.evidence(`the call carrying the link ${carried.isError ? "was refused" : "was NOT refused"}`);
    if (!carried.isError) throw new Error("a call carrying a live upload link ran");
    const after = await putThroughLink(ctx, path, { bytes: contentFile().bytes, name: "fd15.png" });
    ctx.evidence(`the link then answered ${after.status}`);
    if (after.status !== 410) throw new Error("the link still took a file after it was carried in a call");
  },
};
