/**
 * SCRUM-437: the HTTP side of an upload link, `/files/u/<token>`. A PUT
 * takes one file under the link's cap, inside an upload slot, and answers a
 * receipt with the reference a call names the file by. Driven through the
 * real router on a real server on an ephemeral port.
 */

import { createHash } from "node:crypto";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { createFileDownloadRouter } from "./file-download-route";
import { createUploadLink, resetDownloadLinks, takeUpload, UPLOAD_PATH } from "./file-download";
import { uploadsInFlight, withSlot } from "./file-crossing";
import { securityHeaders } from "./security-headers";

const BASE = "https://gw.example.test";
let server: Server;
let origin: string;

async function serve(limits?: { deadlineMs?: number; stallMs?: number }) {
  const app = express();
  app.use(securityHeaders);
  app.use(createFileDownloadRouter({ db: {} as Database, baseUrl: BASE, uploadLimits: limits }));
  // The app behind the router: anything that reaches it answers 200, so a
  // path the router should have kept shows up as a 200.
  app.use((_req, res) => void res.status(200).send("the app"));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => resetDownloadLinks());
afterEach(async () => {
  await new Promise((r) => server?.close(r));
  vi.restoreAllMocks();
});

function mintPath(userId = "user-1", args: Record<string, unknown> = {}): string {
  const result = createUploadLink({ userId, args, baseUrl: BASE });
  return String(JSON.parse(result.content[0].text as string).link.url).replace(BASE, "");
}

const put = (path: string, body: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) =>
  fetch(`${origin}${path}`, { method: "PUT", body, headers });

const PNG = new Uint8Array(70).fill(7);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("PUT /files/u/<token>", () => {
  it("takes the file under the name curl appends, and answers the receipt and the reference", async () => {
    await serve();
    const res = await put(`${mintPath()}/a%20b.png`, PNG);
    expect(res.status).toBe(200);
    const receipt = await res.json();
    expect(receipt.received).toEqual({ name: "a b.png", type: "image/png", bytes: 70, sha256: sha(PNG) });
    expect(receipt.reference.type).toBe("upload");
    const taken = takeUpload(receipt.reference.upload_id, "user-1");
    expect(taken.ok && taken.file.bytes.equals(Buffer.from(PNG))).toBe(true);
  });

  it("decodes a UTF-8 name as curl sends it", async () => {
    await serve();
    const receipt = await (await put(`${mintPath()}/r%C3%A9sum%C3%A9.pdf`, PNG)).json();
    expect(receipt.received.name).toBe("résumé.pdf");
    expect(receipt.received.type).toBe("application/pdf");
  });

  it("prefers the name and type the page sends in headers", async () => {
    await serve();
    const receipt = await (
      await put(mintPath(), PNG, { "X-File-Name": encodeURIComponent("Q3 chart.png"), "X-File-Type": "image/png" })
    ).json();
    expect(receipt.received).toMatchObject({ name: "Q3 chart.png", type: "image/png" });
  });

  it("names a file sent with no name after the link's hint, or upload", async () => {
    await serve();
    expect((await (await put(mintPath("user-1", { name: "hint.txt" }), PNG)).json()).received.name).toBe("hint.txt");
    expect((await (await put(mintPath(), PNG)).json()).received.name).toBe("upload");
  });

  it("names a file upload when its name is made only of characters it cannot keep", async () => {
    await serve();
    const receipt = await (await put(`${mintPath()}/%22%2A%3F%3A%7C`, PNG)).json();
    expect(receipt.received.name).toBe("upload");
  });

  it("keeps a reserved device name's extension under the upload name", async () => {
    await serve();
    const receipt = await (await put(`${mintPath()}/con.png`, PNG)).json();
    expect(receipt.received.name).toBe("upload.png");
  });

  it("takes one file: a second PUT is told the link was used", async () => {
    await serve();
    const path = mintPath();
    expect((await put(path, PNG)).status).toBe(200);
    const again = await put(path, PNG);
    expect(again.status).toBe(410);
    expect(await again.text()).toContain("already been used");
  });

  it("refuses a file over the link's cap, and the link still works", async () => {
    await serve();
    const path = mintPath("user-1", { max_bytes: 10 });
    const over = await put(path, new Uint8Array(11));
    expect(over.status).toBe(413);
    expect(await over.text()).toContain("Nothing was uploaded");
    expect((await put(path, new Uint8Array(10))).status).toBe(200);
  });

  it("holds the cap while reading, for a sender that declares no length", async () => {
    await serve();
    const path = mintPath("user-1", { max_bytes: 10 });
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${origin}${path}`, { method: "PUT", headers: { "Transfer-Encoding": "chunked" } }, (res) =>
        resolve(res.statusCode ?? 0)
      );
      req.on("error", () => resolve(-1));
      req.write(new Uint8Array(6));
      req.end(new Uint8Array(6));
    });
    expect(status).toBe(413);
    expect((await put(path, new Uint8Array(10))).status).toBe(200);
  });

  it("refuses an empty file, and the link still works", async () => {
    await serve();
    const path = mintPath();
    expect((await put(path, new Uint8Array(0))).status).toBe(400);
    expect((await put(path, PNG)).status).toBe(200);
  });

  it("cuts a file that stops arriving, and the link still works", async () => {
    await serve({ stallMs: 100 });
    const path = mintPath();
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${origin}${path}`, { method: "PUT", headers: { "Content-Length": "100" } }, (res) => resolve(res.statusCode ?? 0));
      req.on("error", reject);
      req.write(new Uint8Array(10));
      // ...and nothing more.
    });
    expect(status).toBe(408);
    expect((await put(path, PNG)).status).toBe(200);
  });

  it("refuses while the user has another file in flight, and the link still works", async () => {
    await serve();
    const path = mintPath();
    let release!: () => void;
    const held = withSlot("user-1", "transfer", { clause: "", sentence: "", busy: "" }, () => new Promise<void>((r) => (release = r)));
    const busy = await put(path, PNG);
    expect(busy.status).toBe(503);
    release();
    await held;
    expect((await put(path, PNG)).status).toBe(200);
  });

  it("holds an upload slot while the file arrives, and frees it", async () => {
    await serve({ stallMs: 2_000 });
    const path = mintPath();
    const done = new Promise<number>((resolve) => {
      const req = httpRequest(`${origin}${path}`, { method: "PUT", headers: { "Content-Length": "20" } }, (res) => resolve(res.statusCode ?? 0));
      req.write(new Uint8Array(10));
      setTimeout(() => req.end(new Uint8Array(10)), 150);
    });
    await vi.waitFor(() => expect(uploadsInFlight()).toBe(1));
    expect(await done).toBe(200);
    expect(uploadsInFlight()).toBe(0);
  });

  it("answers the dead states in words", async () => {
    await serve();
    expect((await put(`${UPLOAD_PATH}nonsense`, PNG)).status).toBe(404);
    expect((await fetch(`${origin}${mintPath()}`, { method: "POST", body: PNG })).status).toBe(405);
  });

  it("shows the drop page on a GET, and spends nothing", async () => {
    await serve();
    const path = mintPath();
    const page = await fetch(`${origin}${path}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toMatch(/^text\/html/);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await put(path, PNG)).status).toBe(200);
  });

  it("logs no token and no name", async () => {
    await serve();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
    const path = mintPath();
    await put(`${path}/secret-name.png`, PNG);
    const token = path.split(UPLOAD_PATH)[1];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(token.slice(0, 22));
      expect(line).not.toContain("secret-name");
    }
  });

  it("answers a request whose query carries an upload link as not valid", async () => {
    await serve();
    const path = mintPath();
    const res = await fetch(`${origin}/_next/image?url=${encodeURIComponent(path)}`);
    expect(res.status).toBe(404);
  });

  it("answers an upload path in disguise as not valid, never reaching the app", async () => {
    await serve();
    const token = mintPath().split(UPLOAD_PATH)[1];
    const res = await fetch(`${origin}/files%2Fu%2F${token}`, { method: "PUT", body: PNG });
    expect(res.status).toBe(404);
  });
});

describe("the drop page (SCRUM-437)", () => {
  const nonceOf = (csp: string | null) => /script-src 'nonce-([A-Za-z0-9+/=_-]+)'/.exec(csp ?? "")?.[1];

  it("allows its one script by a nonce made for this response, and nothing else", async () => {
    await serve();
    const path = mintPath();
    const res = await fetch(`${origin}${path}`);
    const csp = res.headers.get("content-security-policy");
    const nonce = nonceOf(csp);
    expect(nonce).toMatch(/^[A-Za-z0-9+/=_-]{22,}$/);
    expect(csp).toBe(
      `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`
    );
    const html = await res.text();
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts).toEqual([`<script nonce="${nonce}">`]);
    const again = nonceOf((await fetch(`${origin}${path}`)).headers.get("content-security-policy"));
    expect(again).not.toBe(nonce);
  });

  it("keeps the anti-framing headers every response carries", async () => {
    await serve();
    const res = await fetch(`${origin}${mintPath()}`);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("has a fixed title, a file picker and an upload button", async () => {
    await serve();
    const html = await (await fetch(`${origin}${mintPath()}`)).text();
    expect(html).toContain("<title>Upload file</title>");
    expect(html).toMatch(/<input[^>]*type="file"/);
    expect(html).toMatch(/<button[^>]*id="send"/);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
  });

  it("names the curl line for a browser without scripts, with this link", async () => {
    await serve();
    const path = mintPath();
    const html = await (await fetch(`${origin}${path}`)).text();
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? "";
    expect(noscript).toContain(`curl -fsS -T &lt;path-to-file&gt; &quot;${BASE}${path}/&quot;`);
  });

  it("shows the name hint as text, never as markup", async () => {
    await serve();
    const html = await (await fetch(`${origin}${mintPath("user-1", { name: '<b>x</b>"onload="y.pdf' })}`)).text();
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;&quot;onload=&quot;y.pdf");
  });

  it("wraps the receipt's long hash, so a phone does not widen to fit it", async () => {
    await serve();
    const html = await (await fetch(`${origin}${mintPath()}`)).text();
    expect(html).toContain("#receipt{overflow-wrap:anywhere;word-break:break-all");
  });

  it("states the link's own limit", async () => {
    await serve();
    const html = await (await fetch(`${origin}${mintPath("user-1", { max_bytes: 5 * 1024 * 1024 })}`)).text();
    expect(html).toContain("5 MB");
  });

  it("answers a used or expired link with its sentence, not the page", async () => {
    await serve();
    const path = mintPath();
    await put(path, PNG);
    const used = await fetch(`${origin}${path}`);
    expect(used.status).toBe(410);
    expect(used.headers.get("content-type")).toMatch(/^text\/plain/);
  });

  it("writes everything it learns from the server with textContent, never as markup", async () => {
    await serve();
    const html = await (await fetch(`${origin}${mintPath()}`)).text();
    const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
    expect(script).toContain("XMLHttpRequest");
    expect(script).toContain('"X-File-Name"');
  });
});
