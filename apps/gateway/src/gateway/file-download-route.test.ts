/**
 * SCRUM-420: the download route over real HTTP, on a loopback port. The
 * store behind it is the real one; only the read from the source is a
 * stand-in.
 */

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { createDownloadLink, resetDownloadLinks, revokeLinksCarriedIn, DOWNLOAD_PATH, type DownloadDeps } from "./file-download";
import {
  contentDisposition,
  createFileDownloadRouter,
  downloadPage,
  looksLikeDownloadPath,
  quietDecodeErrors,
  sendBytes,
} from "./file-download-route";
import { request as httpRequest } from "node:http";
import { securityHeaders } from "./security-headers";

const FILE = Buffer.from("From: a@example.com\r\nSubject: fixture\r\n\r\nbody\r\n");
const SHA = createHash("sha256").update(FILE).digest("hex");
const NAME = "Résumé (final) <b>.eml";

const source = { bytes: FILE, name: NAME, type: "message/rfc822", status: 200 };
const deps: DownloadDeps = {
  resolveToken: async () => ({ token: "source-token-fixture", accountEmail: "a@example.com", scopes: "https://www.googleapis.com/auth/gmail.modify" }),
  resolvePluginUrl: async () => "http://localhost:40001/mcp",
  surface: "mcp",
  connectionsUrl: "https://gw.example.test/dashboard/connections",
  fetchFn: (async () =>
    source.status === 200
      ? new Response(new Uint8Array(source.bytes), {
          status: 200,
          headers: { "Content-Type": source.type, "X-File-Name": encodeURIComponent(source.name) },
        })
      : Response.json({ error: "upstream", code: "upstream" }, { status: source.status })) as unknown as typeof fetch,
};

let base = "";
let close: () => Promise<void>;
const sentEvents: unknown[] = [];
const logLines: string[] = [];

beforeAll(async () => {
  const app = express();
  app.use(securityHeaders);
  app.use(
    createFileDownloadRouter({
      db: {} as Database,
      baseUrl: "https://gw.example.test",
      depsFor: () => deps,
      onSent: (event) => sentEvents.push(event),
    })
  );
  app.all("/{*path}", (_req, res) => void res.status(418).send("the app"));
  app.use(quietDecodeErrors);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((r) => server.close(() => r()));
  vi.spyOn(console, "log").mockImplementation((...args) => void logLines.push(args.join(" ")));
});
afterAll(() => close());

beforeEach(() => {
  resetDownloadLinks();
  Object.assign(source, { bytes: FILE, name: NAME, type: "message/rfc822", status: 200 });
  sentEvents.length = 0;
  logLines.length = 0;
});

/** A GET whose path goes on the wire exactly as written. */
function rawGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(base);
    const req = httpRequest({ hostname, port, path, method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function mint(ref: Record<string, unknown> = { type: "gmail_message", message_id: "m1" }): Promise<string> {
  const result = await createDownloadLink({ userId: "user-1", args: { file: ref }, baseUrl: "https://gw.example.test", deps });
  const url = String(JSON.parse(result.content[0].text!).link.url);
  return `${DOWNLOAD_PATH}${url.split(DOWNLOAD_PATH)[1]}`;
}

const SAFE = { "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
function expectSafe(res: Response) {
  for (const [k, v] of Object.entries(SAFE)) expect(res.headers.get(k), k).toBe(v);
  expect(res.headers.get("set-cookie")).toBeNull();
}

describe("GET", () => {
  it("shows a page with the name, the size and one button, and spends nothing", async () => {
    const path = await mint();
    for (let i = 0; i < 3; i++) {
      const res = await fetch(base + path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBeNull();
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(res.headers.get("content-security-policy")).toContain("form-action 'self'");
      expectSafe(res);
      const html = await res.text();
      expect(html).toContain('<form method="post"><button type="submit">Save file</button></form>');
      expect(html).toContain(`${FILE.length} bytes`);
      expect(html).not.toContain("<script");
      // No byte of the file.
      expect(html).not.toContain("Subject: fixture");
    }
    expect((await fetch(base + path, { method: "POST" })).status).toBe(200);
  });

  it("shows the cleaned name and keeps it out of the title", async () => {
    const html = await (await fetch(base + (await mint()))).text();
    expect(html).toContain("<h1>Résumé (final) b.eml</h1>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("<title>Save file</title>");
  });
});

describe("POST", () => {
  it("sends the file, as an attachment, with the bytes and hash of the receipt", async () => {
    const res = await fetch(base + (await mint()), { method: "POST" });
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(FILE)).toBe(true);
    expect(createHash("sha256").update(body).digest("hex")).toBe(SHA);
    expect(res.headers.get("content-type")).toBe("message/rfc822");
    expect(res.headers.get("content-length")).toBe(String(FILE.length));
    const disposition = res.headers.get("content-disposition")!;
    expect(disposition.startsWith("attachment; ")).toBe(true);
    expect(disposition).not.toContain("inline");
    expect(disposition).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9%20%28final%29%20b.eml");
    expect(res.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'; frame-ancestors 'none'");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("accept-ranges")).toBe("none");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expectSafe(res);
    expect(sentEvents).toEqual([{ userId: "user-1", bytes: FILE.length, complete: true }]);
  });

  it("never sends an attachment under the type its sender declared", async () => {
    Object.assign(source, { name: "page.html", type: "text/html" });
    const res = await fetch(base + (await mint({ type: "gmail_attachment", message_id: "m1", part_id: "1" })), { method: "POST" });
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; /);
  });

  it("a second POST and a later GET both say the link was used", async () => {
    const path = await mint();
    await (await fetch(base + path, { method: "POST" })).arrayBuffer();
    for (const method of ["POST", "GET"]) {
      const res = await fetch(base + path, { method });
      expect(res.status).toBe(410);
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await res.text()).toBe("This download link has already been used. A link works once. Ask for a new one in your conversation.");
      expectSafe(res);
    }
  });

  it("says not valid for a token nobody minted", async () => {
    const res = await fetch(`${base}${DOWNLOAD_PATH}${"A".repeat(22)}.${"B".repeat(43)}`, { method: "POST" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("This download link is not valid. Ask for a new one in your conversation.");
  });

  it("sends nothing when the file changed, and says so", async () => {
    const path = await mint();
    source.bytes = Buffer.from("something else entirely");
    const res = await fetch(base + path, { method: "POST" });
    expect(res.status).toBe(409);
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(await res.text()).toContain("has changed at its source");
    expect(sentEvents).toEqual([]);
  });

  it("a failed read is a 502 and the link still works after", async () => {
    const path = await mint();
    source.status = 502;
    const failed = await fetch(base + path, { method: "POST" });
    expect(failed.status).toBe(502);
    expect(await failed.text()).toBe("The file could not be read from its source. Nothing was sent. Try the link again.");
    source.status = 200;
    expect((await fetch(base + path, { method: "POST" })).status).toBe(200);
  });
});

describe("everything else", () => {
  it.each(["HEAD", "PUT", "DELETE", "PATCH"])("%s is refused and spends nothing", async (method) => {
    const path = await mint();
    const res = await fetch(base + path, { method });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, POST");
    expect((await fetch(base + path, { method: "POST" })).status).toBe(200);
  });

  it("leaves every other path to the app", async () => {
    expect((await fetch(`${base}/somewhere-else`)).status).toBe(418);
    expect((await fetch(`${base}/filesystem`)).status).toBe(418);
  });

  it("keeps everything under its prefix from the app, token or not", async () => {
    const path = await mint();
    for (const tail of ["/extra", "/", "/extra/more?x=1"]) {
      const res = await fetch(base + path + tail, { method: tail === "/" ? "POST" : "GET" });
      expect(res.status, tail).toBe(404);
      expect(await res.text()).toBe("This download link is not valid. Ask for a new one in your conversation.");
    }
    for (const other of ["/files", "/files/", "/files/x", "/files/d", "/files/d/"]) {
      expect((await fetch(base + other)).status, other).toBe(404);
    }
    // None of that spent the link.
    expect((await fetch(base + path, { method: "POST" })).status).toBe(200);
  });

  it("a malformed escape after a live token prints nothing of the token, on either stream", async () => {
    const path = await mint();
    const token = path.slice(DOWNLOAD_PATH.length);
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(args.map(String).join(" ")));
    try {
      for (const method of ["GET", "POST"]) {
        const res = await fetch(`${base}${path}%`, { method });
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain(token);
      }
    } finally {
      spy.mockRestore();
    }
    const everything = [...errors, ...logLines].join("\n");
    expect(everything).not.toContain(token.split(".")[0]);
    expect(everything).not.toContain("URIError");
    expect((await fetch(base + path, { method: "POST" })).status).toBe(200);
  });

  it("stops a path that is the prefix under another spelling, before the app and without printing it", async () => {
    const path = await mint();
    const token = path.slice(DOWNLOAD_PATH.length);
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(args.map(String).join(" ")));
    const spellings = [
      `/files%2Fd%2F${token}`,
      `//files/d/${token}`,
      `/%66iles/d/${token}`,
      `/./files/d/${token}`,
      `/files\\d\\${token}`,
      `/FILES%2fd/${token}`,
      `/%2566iles/d/${token}`,
    ];
    try {
      for (const spelling of spellings) {
        for (const tail of ["", "%"]) {
          // Raw, because fetch would tidy some of these before sending.
          const res = await rawGet(spelling + tail);
          expect(res.status, spelling + tail).toBe(404);
          expect(res.body).toBe("This download link is not valid. Ask for a new one in your conversation.");
        }
      }
    } finally {
      spy.mockRestore();
    }
    const everything = [...errors, ...logLines].join("\n");
    expect(everything).not.toContain(token.split(".")[0]);
    expect((await fetch(base + path, { method: "POST" })).status).toBe(200);
  });

  it("stops a link handed to another route as a parameter, the image optimizer first of all", async () => {
    const path = await mint();
    const token = path.slice(DOWNLOAD_PATH.length);
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(args.map(String).join(" ")));
    const carriers = [
      `/_next/image?url=${path}&w=64&q=75`,
      `/_next/image?url=${encodeURIComponent(path)}&w=64&q=75`,
      `/_next/image?w=64&url=%252Ffiles%252Fd%252F${token}`,
      `/_next/image?url=//files/d/${token}`,
      `/_next/image?url=/FILES/d/${token}%`,
      `/dashboard?next=${encodeURIComponent(`https://gw.example.test${path}`)}`,
    ];
    try {
      for (const carrier of carriers) {
        const res = await rawGet(carrier);
        // 404 from the router, never the app's 418.
        expect(res.status, carrier).toBe(404);
        expect(res.body).toBe("This download link is not valid. Ask for a new one in your conversation.");
      }
    } finally {
      spy.mockRestore();
    }
    expect([...errors, ...logLines].join("\n")).not.toContain(token.split(".")[0]);
    // An ordinary image request, and an ordinary query, still reach the app.
    expect((await rawGet("/_next/image?url=%2Flogo.png&w=64&q=75")).status).toBe(418);
    expect((await rawGet("/docs/file-references?ref=files")).status).toBe(418);
    expect((await fetch(base + path, { method: "POST" })).status).toBe(200);
  });

  it("the app's last handler names a decode failure and prints nothing of the path", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(args.map(String).join(" ")));
    try {
      const res = await rawGet("/somewhere/SECRET-IN-PATH%");
      expect(res.status).toBe(400);
      expect(res.body).toBe("Bad request.");
    } finally {
      spy.mockRestore();
    }
    expect(errors).toEqual(["[http] a request target could not be decoded"]);
  });

  it.each([
    ["/files", true],
    ["/files/d/x", true],
    ["/files?x=1", true],
    ["/filesystem", false],
    ["/docs/file-references", false],
    ["/dashboard?next=/files/d/x", false],
    ["/", false],
  ])("looksLikeDownloadPath(%j) is %j", (url, expected) => {
    expect(looksLikeDownloadPath(url)).toBe(expected);
  });

  it("says a link carried in a tool call was cancelled, not that it was used", async () => {
    const path = await mint();
    const token = path.slice(DOWNLOAD_PATH.length);
    expect(revokeLinksCarriedIn("user-1", () => JSON.stringify({ body: token }))).toBe(true);
    const res = await fetch(base + path, { method: "POST" });
    expect(res.status).toBe(410);
    expect(await res.text()).toBe(
      "This download link was cancelled because it was passed to another tool. Ask for a new one in your conversation."
    );
  });

  it("logs the method, the outcome and a byte count, and nothing of the link or the file", async () => {
    const path = await mint();
    const token = path.slice(DOWNLOAD_PATH.length);
    await fetch(base + path);
    await (await fetch(base + path, { method: "POST" })).arrayBuffer();
    await fetch(base + path, { method: "POST" });
    const ours = logLines.filter((l) => l.startsWith("[file-download]"));
    expect(ours).toEqual([
      "[file-download] method=GET outcome=live bytes=0",
      `[file-download] method=POST outcome=sent bytes=${FILE.length}`,
      "[file-download] method=POST outcome=used bytes=0",
    ]);
    const everything = logLines.join("\n");
    for (const secret of [token, token.split(".")[0], "Résumé", SHA, "user-1", DOWNLOAD_PATH]) {
      expect(everything).not.toContain(secret);
    }
  });
});

describe("the pieces", () => {
  it("content disposition is always attachment, with a plain fallback and the real name", () => {
    expect(contentDisposition('a"b\\c%.txt')).toBe(`attachment; filename="a_b_c_.txt"; filename*=UTF-8''a%22b%5Cc%25.txt`);
    expect(contentDisposition("naïve.pdf")).toBe(`attachment; filename="na_ve.pdf"; filename*=UTF-8''na%C3%AFve.pdf`);
  });

  it("the page escapes every character that could leave its element", () => {
    const html = downloadPage(`"><script>alert(1)</script>&'`, 10);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&#34;&#62;&#60;script&#62;");
  });

  /** A response whose reader takes `accept` chunks and then stops. */
  function slowReader(accept: number) {
    const res = new EventEmitter() as EventEmitter & { written: number; destroyed: boolean; ended: boolean; write(b: Buffer): boolean; end(): void; destroy(): void };
    Object.assign(res, {
      written: 0,
      destroyed: false,
      ended: false,
      write(b: Buffer) {
        res.written += b.length;
        accept -= 1;
        return accept > 0;
      },
      end() {
        res.ended = true;
      },
      destroy() {
        res.destroyed = true;
        res.emit("close");
      },
    });
    return res;
  }

  it("cuts a reader that stops taking the file, and does not keep writing", async () => {
    const res = slowReader(2);
    const outcome = await sendBytes(res as never, Buffer.alloc(10 * 100), { chunk: 100, stallMs: 20, deadlineMs: 5_000 });
    expect(outcome).toBe("cut");
    expect(res.destroyed).toBe(true);
    expect(res.ended).toBe(false);
    expect(res.written).toBe(200);
  });

  it("cuts a reader that is steady but too slow for the whole deadline", async () => {
    const res = slowReader(1);
    res.on("newListener", (event) => {
      // Drains every 15 ms: never stalled, never done in time.
      if (event === "drain") setTimeout(() => res.emit("drain"), 15);
    });
    const origWrite = res.write.bind(res);
    res.write = (b: Buffer) => (origWrite(b), false);
    const outcome = await sendBytes(res as never, Buffer.alloc(100 * 100), { chunk: 100, stallMs: 1_000, deadlineMs: 80 });
    expect(outcome).toBe("cut");
    expect(res.written).toBeLessThan(100 * 100);
  });

  it("stops when the other end goes away", async () => {
    const res = slowReader(1);
    setTimeout(() => res.emit("close"), 10);
    expect(await sendBytes(res as never, Buffer.alloc(1000), { chunk: 100, stallMs: 5_000 })).toBe("cut");
  });
});
