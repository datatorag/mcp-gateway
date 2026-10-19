import { createHash } from "node:crypto";
import type { CaseContext, ToolResult } from "./types";
import { resultJson } from "./result-json";
import { linkPath, type DownloadReceipt } from "./download-link";

/** What the Drive file reference cases share (SCRUM-428 Part B). */

/** Save a download link once, from the answer of the case's own
 * file_download_link call (made in the case, where the arguments check reads
 * it), and check that the bytes that arrive are the ones the receipt
 * described. Answers the body and the headers that matter, for the case to
 * judge further. */
export async function saveThroughLink(ctx: CaseContext, made: ToolResult) {
  const receipt = resultJson<DownloadReceipt>("file_download_link", made);
  const bytes = receipt.sent?.bytes;
  const sha256 = receipt.sent?.sha256;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
    throw new Error("the receipt does not say how many bytes the link will send as a positive whole number");
  }
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("the receipt's sha256 is not 64 lowercase hex characters");
  }
  const saved = await ctx.http(linkPath(receipt), { method: "POST" });
  const body = Buffer.from(await saved.arrayBuffer());
  if (saved.status !== 200) throw new Error(`the POST did not answer the file: status ${saved.status}`);
  if (!(saved.headers.get("content-disposition") ?? "").startsWith("attachment;")) {
    throw new Error("the file was not sent as an attachment");
  }
  const hash = createHash("sha256").update(body).digest("hex");
  if (body.length !== bytes || hash !== sha256) throw new Error("the bytes the link sent are not the bytes the receipt described");
  return { body, sha256, name: receipt.file?.name ?? "", type: saved.headers.get("content-type") ?? "" };
}
