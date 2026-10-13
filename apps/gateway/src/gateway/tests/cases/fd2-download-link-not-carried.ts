import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { linkPath, type DownloadReceipt as Receipt } from "../download-link";

/**
 * FD2 (Gmail scenario): a tool call that carries a live download link is
 * refused, and the link is dead afterwards.
 *
 * The carrying call is `echo`, which sends nothing anywhere: the refusal is
 * made by the gateway before any tool runs, so which tool it is does not
 * matter, and a tool with no effect cannot leave residue if the refusal
 * were ever missing.
 *
 * THE SECOND HALF IS THE POINT. A refusal that left the link alive would
 * still let it be carried some other way; so the link is then used, and
 * must already be dead.
 */
export const fd2DownloadLinkNotCarried: TestCase = {
  id: "FD2",
  title: "a call that carries a live download link is refused and the link is cancelled",
  covers: ["file_download_link", "echo"],
  accounts: ["reader"],
  fixtures: ["smokeMessage"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const receipt = resultJson<Receipt>(
      "file_download_link",
      await ctx.call("file_download_link", {
        file: { type: "gmail_message", message_id: ctx.fixture("smokeMessage"), account: ctx.address("reader") },
      })
    );
    const path = linkPath(receipt);

    const carried = await ctx.call("echo", { message: `${ctx.stamp} ${receipt.link?.url}` });
    ctx.evidence(`the call carrying the link ${carried.isError ? "was refused" : "was NOT refused"}`);
    if (!carried.isError) throw new Error("a call carrying a live download link ran, so a link can be sent on through the gateway");

    const after = await ctx.http(path, { method: "POST" });
    await after.arrayBuffer();
    ctx.evidence(`the link then answered ${after.status}`);
    if (after.status !== 410) {
      throw new Error("the link still worked after it was carried in a call, so the refusal did not cancel it");
    }
  },
};
