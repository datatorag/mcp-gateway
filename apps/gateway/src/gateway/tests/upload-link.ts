import type { CaseContext, ToolResult } from "./types";
import { resultJson } from "./result-json";

/** What the upload link cases share (SCRUM-437). */

export type UploadLinkReceipt = {
  link?: { url?: string; uses?: number; expires_at?: string; command?: string };
  max_bytes?: number;
};

export type UploadedReceipt = {
  received?: { name?: string; type?: string; bytes?: number; sha256?: string };
  reference?: { type?: string; upload_id?: string };
};

/** The path of an upload link, from the tool's receipt. `ctx.http` takes a
 * path and never a URL, so the link's own host is dropped and the request
 * goes to this machine whatever the receipt says. */
export function uploadPath(made: ToolResult): string {
  const url = resultJson<UploadLinkReceipt>("file_upload_link", made).link?.url;
  if (typeof url !== "string") throw new Error("the receipt carries no link");
  const path = new URL(url).pathname;
  if (!path.startsWith("/files/u/")) throw new Error("the receipt's link is not an upload link of this service");
  return path;
}

/** Sends a file to an upload link the way the receipt's curl command does:
 * a PUT of the bytes, the file's name appended to the path. */
export async function putThroughLink(
  ctx: CaseContext,
  path: string,
  file: { bytes: Buffer; name: string }
): Promise<{ status: number; receipt?: UploadedReceipt; text: string }> {
  const res = await ctx.http(`${path}/${encodeURIComponent(file.name)}`, { method: "PUT", body: new Uint8Array(file.bytes) });
  const text = await res.text();
  if (res.status !== 200) return { status: res.status, text };
  return { status: 200, receipt: JSON.parse(text) as UploadedReceipt, text };
}

/** Sends the file through the link the case made, refusing to go on unless
 * the receipt names the file the case sent. The case makes the
 * `file_upload_link` call itself, so what it declares is what it calls. */
export async function uploadThroughLink(
  ctx: CaseContext,
  made: ToolResult,
  file: { bytes: Buffer; name: string; sha256: string }
): Promise<{ upload_id: string }> {
  const path = uploadPath(made);
  const sent = await putThroughLink(ctx, path, file);
  if (sent.status !== 200 || !sent.receipt) throw new Error(`the upload was refused: status ${sent.status}`);
  if (sent.receipt.received?.sha256 !== file.sha256 || sent.receipt.received?.bytes !== file.bytes.length) {
    throw new Error("the upload's receipt is not the file the case sent");
  }
  const upload_id = sent.receipt.reference?.upload_id;
  if (sent.receipt.reference?.type !== "upload" || typeof upload_id !== "string") {
    throw new Error("the upload's receipt carries no upload reference");
  }
  return { upload_id };
}
