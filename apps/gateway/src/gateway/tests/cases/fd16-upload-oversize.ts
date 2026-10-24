import type { TestCase } from "../types";
import { putThroughLink, uploadPath } from "../upload-link";

/**
 * FD16 (SCRUM-437): a file over the link's cap is refused, nothing is
 * held, and the link still takes a file within it.
 */
export const fd16UploadOversize: TestCase = {
  id: "FD16",
  title: "a file over an upload link's limit is refused, and the link still works",
  covers: ["file_upload_link"],
  accounts: ["sender"],
  timeoutMs: 60_000,
  run: async (ctx) => {
    const path = uploadPath(await ctx.call("file_upload_link", { max_bytes: 1000 }));
    const over = await putThroughLink(ctx, path, { bytes: Buffer.alloc(1001, 1), name: "fd16.bin" });
    ctx.evidence(`one byte over answered ${over.status}`);
    if (over.status !== 413 || !over.text.includes("Nothing was uploaded")) throw new Error("a file over the link's limit was not refused");
    const within = await putThroughLink(ctx, path, { bytes: Buffer.alloc(1000, 1), name: "fd16.bin" });
    ctx.evidence(`a file within it then answered ${within.status}`);
    if (within.status !== 200) throw new Error("the link stopped working after a refused file");
  },
};
