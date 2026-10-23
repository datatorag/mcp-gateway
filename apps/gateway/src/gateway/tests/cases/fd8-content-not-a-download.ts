import type { TestCase } from "../types";
import { contentFile } from "../content-file";

/**
 * FD8 (SCRUM-437): a download link is not made from a `content` reference.
 * A link re-reads its source when it is used, and a file the caller holds
 * has no source to re-read. The refusal says so and reads nothing.
 */
export const fd8ContentNotADownload: TestCase = {
  id: "FD8",
  title: "a download link is refused for a file sent as a content reference",
  covers: ["file_download_link"],
  accounts: ["sender"],
  timeoutMs: 30_000,
  run: async (ctx) => {
    const res = await ctx.call(
      "file_download_link",
      { file: { type: "content", name: "fd8.png", base64: contentFile().base64 } },
      { as: "sender" }
    );
    const text = res.content.map((c) => c.text ?? "").join(" ");
    ctx.evidence(`refused: ${res.isError === true}`);
    if (res.isError !== true) throw new Error("a download link was made from a content reference");
    if (!text.includes("already on your side")) throw new Error("the refusal does not say the file is already on the caller's side");
  },
};
