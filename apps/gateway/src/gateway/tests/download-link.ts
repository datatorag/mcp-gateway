/** What the download link cases share (SCRUM-420). */

export type DownloadReceipt = {
  file?: { name?: string; type?: string };
  sent?: { bytes?: number; sha256?: string };
  link?: { url?: string; uses?: number; expires_at?: string; command?: string };
};

/** The path of a download link, from the receipt. `ctx.http` takes a path
 * and never a URL, so the link's own host is dropped here and the request
 * goes to this machine whatever the receipt says. */
export function linkPath(receipt: DownloadReceipt): string {
  const url = receipt.link?.url;
  if (typeof url !== "string") throw new Error("the receipt carries no link");
  const path = new URL(url).pathname;
  if (!path.startsWith("/files/d/")) throw new Error("the receipt's link is not a download link of this service");
  return path;
}
