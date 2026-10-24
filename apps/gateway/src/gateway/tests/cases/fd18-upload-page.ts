import type { TestCase } from "../types";
import { uploadPath } from "../upload-link";

/**
 * FD18 (SCRUM-437): an upload link opened in a browser shows the drop page,
 * whose one script is allowed by a nonce made for that response, and which
 * the page cannot be framed. Opening it spends nothing: the link still takes
 * its file afterwards.
 */
export const fd18UploadPage: TestCase = {
  id: "FD18",
  title: "an upload link opens a page that takes the file, with its script locked to that page",
  covers: ["file_upload_link"],
  accounts: ["sender"],
  timeoutMs: 60_000,
  run: async (ctx) => {
    const path = uploadPath(await ctx.call("file_upload_link", {}));
    const page = await ctx.http(path);
    const html = await page.text();
    const csp = page.headers.get("content-security-policy") ?? "";
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    ctx.evidence(`the page answered ${page.status}, ${page.headers.get("content-type")}; a script nonce: ${Boolean(nonce)}`);
    if (page.status !== 200 || !(page.headers.get("content-type") ?? "").startsWith("text/html")) throw new Error("the link did not open a page");
    if (!html.includes("<title>Upload file</title>") || !/<input[^>]*type="file"/.test(html)) throw new Error("the page is not the drop page");
    if (!nonce || !html.includes(`<script nonce="${nonce}">`)) throw new Error("the page's script is not allowed by a nonce made for it");
    if (!csp.includes("frame-ancestors 'none'")) throw new Error("the page can be framed");
    const put = await ctx.http(`${path}/fd18.txt`, { method: "PUT", body: new TextEncoder().encode(`FD18 ${ctx.stamp}`) });
    await put.text();
    ctx.evidence(`a file sent after the page was opened answered ${put.status}`);
    if (put.status !== 200) throw new Error("opening the page spent the link");
  },
};
