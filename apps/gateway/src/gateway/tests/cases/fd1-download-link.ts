import { createHash } from "node:crypto";
import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { linkPath, type DownloadReceipt as Receipt } from "../download-link";

/**
 * FD1 (Gmail scenario): a download link saves the standing message, once,
 * and the bytes are the ones the receipt described.
 *
 * THE CHECK IS ON THE BYTES RECEIVED, hashed here, against the SHA-256 the
 * tool stated before anything was downloaded. A link that sent a different
 * file, or the right file altered, would fail on that line and on no other.
 *
 * THE ORDER IS THE CLAIM. A GET first, twice, because a GET must show a
 * page and spend nothing; then the POST; then a second POST, which must be
 * refused in the words a user would read; then a token nobody made.
 *
 * It reads and changes nothing: no mail is sent, moved or trashed.
 *
 * NOTHING ABOUT THE FILE IS WRITTEN DOWN. The evidence carries byte counts
 * and statuses; never the name, the hash or the link.
 *
 * WHAT IT DOES NOT PROVE: that a browser saves the file under its name, or
 * that the response survives the edge in front of the gateway. This request
 * goes to the process directly.
 */
export const fd1DownloadLink: TestCase = {
  id: "FD1",
  title: "a download link shows a page, saves the file once, and the bytes match the receipt",
  covers: ["file_download_link"],
  accounts: ["reader"],
  fixtures: ["smokeMessage"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const message_id = ctx.fixture("smokeMessage");
    const receipt = resultJson<Receipt>(
      "file_download_link",
      await ctx.call("file_download_link", {
        file: { type: "gmail_message", message_id, account: ctx.address("reader") },
      })
    );
    const bytes = receipt.sent?.bytes;
    const sha256 = receipt.sent?.sha256;
    if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
      throw new Error("the receipt does not say how many bytes the link will send as a positive whole number");
    }
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error("the receipt's sha256 is not 64 lowercase hex characters, so a saved file could not be checked against it");
    }
    if (receipt.link?.uses !== 1) throw new Error("the receipt does not say the link works once");
    const path = linkPath(receipt);

    for (const attempt of [1, 2]) {
      const page = await ctx.http(path);
      const html = await page.text();
      if (page.status !== 200 || !(page.headers.get("content-type") ?? "").startsWith("text/html")) {
        throw new Error(`GET ${attempt} did not answer the page: status ${page.status}`);
      }
      if (page.headers.get("content-disposition")) throw new Error("a GET answered a file, so opening the link would spend it");
      if (!html.includes('<form method="post">')) throw new Error("the page has no button to save the file");
    }
    ctx.evidence("two GETs answered the page and no file");

    const saved = await ctx.http(path, { method: "POST" });
    const body = Buffer.from(await saved.arrayBuffer());
    if (saved.status !== 200) throw new Error(`the POST did not answer the file: status ${saved.status}`);
    const disposition = saved.headers.get("content-disposition") ?? "";
    if (!disposition.startsWith("attachment;")) throw new Error("the file was not sent as an attachment");
    for (const [header, value] of [
      ["content-type", "message/rfc822"],
      ["x-content-type-options", "nosniff"],
      ["cache-control", "no-store"],
      ["referrer-policy", "no-referrer"],
    ]) {
      if (saved.headers.get(header) !== value) throw new Error(`the file's ${header} header is not ${value}`);
    }
    if (saved.headers.get("set-cookie")) throw new Error("the download set a cookie");
    const sizesAgree = body.length === bytes;
    const hashesAgree = createHash("sha256").update(body).digest("hex") === sha256;
    ctx.evidence(
      `${body.length} bytes arrived (the receipt said ${bytes}); the SHA-256 of what arrived ${hashesAgree ? "is" : "is NOT"} the receipt's`
    );
    if (!sizesAgree || !hashesAgree) {
      throw new Error("the bytes the link sent are not the bytes the receipt described");
    }

    const again = await ctx.http(path, { method: "POST" });
    const againText = await again.text();
    ctx.evidence(`a second POST answered ${again.status}`);
    if (again.status !== 410 || !againText.includes("already been used")) {
      throw new Error("a second POST was not refused as already used, so the link works more than once");
    }

    const forged = await ctx.http(`/files/d/${"A".repeat(22)}.${"B".repeat(43)}`, { method: "POST" });
    await forged.text();
    ctx.evidence(`a token nobody made answered ${forged.status}`);
    if (forged.status !== 404) throw new Error("a token nobody made was not answered 404");
  },
};
