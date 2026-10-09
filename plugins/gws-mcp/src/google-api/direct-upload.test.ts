import { afterEach, describe, expect, it, vi } from "vitest";
import { RESUMABLE_CHUNK, RESUMABLE_THRESHOLD, directUpload, gmailAttachmentBytes } from "./direct-upload.js";

const TOKEN = "ya29.SECRET-bearer-upload";

async function* chunks(total: number, size: number): AsyncGenerator<Uint8Array> {
  for (let sent = 0; sent < total; sent += size) {
    const n = Math.min(size, total - sent);
    const b = Buffer.alloc(n);
    for (let i = 0; i < n; i++) b[i] = (sent + i) % 251;
    yield b;
  }
}
const expected = (total: number) => {
  const b = Buffer.alloc(total);
  for (let i = 0; i < total; i++) b[i] = i % 251;
  return b;
};

afterEach(() => vi.restoreAllMocks());

describe("directUpload", () => {
  it("at or under the threshold: one multipart/related request carrying the metadata and the exact bytes", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      seen.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ id: "f1" }), { status: 200 });
    });
    const out = await directUpload(TOKEN, "drive", "files", "create", {
      params: { supportsAllDrives: true },
      metadata: { name: "a.bin", parents: ["p1"] },
      contentType: "application/octet-stream",
      source: chunks(RESUMABLE_THRESHOLD, 64 * 1024),
    });
    expect(out.data).toEqual({ id: "f1" });
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0].url);
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/upload/drive/v3/files");
    expect(url.searchParams.get("uploadType")).toBe("multipart");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    const headers = seen[0].init.headers as Record<string, string>;
    const boundary = /boundary=(.+)$/.exec(headers["Content-Type"])?.[1] as string;
    const body = Buffer.from(seen[0].init.body as Uint8Array);
    const head = body.subarray(0, 400).toString("latin1");
    expect(head).toContain(`--${boundary}\r\nContent-Type: application/json`);
    expect(head).toContain('{"name":"a.bin","parents":["p1"]}');
    const start = body.indexOf("\r\n\r\n", body.indexOf("application/octet-stream")) + 4;
    const end = body.lastIndexOf(`\r\n--${boundary}--`);
    expect(body.subarray(start, end).equals(expected(RESUMABLE_THRESHOLD))).toBe(true);
  });

  it("over the threshold: a resumable session in bounded chunks that reassemble to the exact bytes", async () => {
    const total = RESUMABLE_CHUNK * 2 + 12_345;
    const session = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=abc";
    const puts: Array<{ range: string; size: number }> = [];
    const received: Buffer[] = [];
    let opened: { url: string; init: RequestInit } | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        opened = { url, init: init ?? {} };
        return new Response("", { status: 200, headers: { Location: session } });
      }
      expect(url).toBe(session);
      const body = Buffer.from(init?.body as Uint8Array);
      received.push(body);
      const range = (init?.headers as Record<string, string>)["Content-Range"];
      puts.push({ range, size: body.length });
      // Google's 308 says in Range how much it now holds.
      const upto = /^bytes \d+-(\d+)\//.exec(range)?.[1];
      return range.endsWith("/*")
        ? new Response(null, { status: 308, headers: { Range: `bytes=0-${upto}` } })
        : new Response(JSON.stringify({ id: "big" }), { status: 200 });
    });

    const out = await directUpload(TOKEN, "drive", "files", "create", {
      metadata: { name: "big.bin" },
      contentType: "video/mp4",
      source: chunks(total, 1_000_003),
    });
    expect(out.data).toEqual({ id: "big" });
    expect(new URL(opened!.url).pathname).toBe("/resumable/upload/drive/v3/files");
    expect((opened!.init.headers as Record<string, string>)["X-Upload-Content-Type"]).toBe("video/mp4");
    expect(String(opened!.init.body)).toBe('{"name":"big.bin"}');

    expect(puts.map((p) => p.range)).toEqual([
      `bytes 0-${RESUMABLE_CHUNK - 1}/*`,
      `bytes ${RESUMABLE_CHUNK}-${RESUMABLE_CHUNK * 2 - 1}/*`,
      `bytes ${RESUMABLE_CHUNK * 2}-${total - 1}/${total}`,
    ]);
    // Flat memory is the claim: no request ever carries more than one chunk,
    // and every chunk but the last is a multiple of 256 KiB.
    expect(Math.max(...puts.map((p) => p.size))).toBe(RESUMABLE_CHUNK);
    for (const p of puts.slice(0, -1)) expect(p.size % (256 * 1024)).toBe(0);
    expect(Buffer.concat(received).equals(expected(total))).toBe(true);
  });

  it("refuses to follow an upload session that points off Google, and sends it nothing", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      return new Response("", { status: 200, headers: { Location: "https://evil.example/upload?upload_id=abc" } });
    });
    await expect(
      directUpload(TOKEN, "drive", "files", "create", {
        contentType: "application/octet-stream",
        source: chunks(RESUMABLE_THRESHOLD + 1, 1 << 20),
      })
    ).rejects.toThrow(/non-Google URL/);
    expect(urls.every((u) => u.startsWith("https://www.googleapis.com/"))).toBe(true);
  });

  it.each([
    "https://www.googleapis.com:8443/upload/x?upload_id=1",
    "https://user:pw@www.googleapis.com/upload/x?upload_id=1",
    "https://www.googleapis.com@evil.example/upload",
    "https://evilgoogleapis.com/upload",
    "http://www.googleapis.com/upload/x",
    "https://www.googleapis.com./upload/x",
  ])("refuses the session URL %s", async (location) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 200, headers: { Location: location } }));
    await expect(
      directUpload(TOKEN, "drive", "files", "create", {
        contentType: "application/octet-stream",
        source: chunks(RESUMABLE_THRESHOLD + 1, 1 << 20),
      })
    ).rejects.toThrow(/non-Google URL/);
  });

  it("a refused chunk surfaces as the API error, not as a silent success", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
      init?.method === "POST"
        ? new Response("", { status: 200, headers: { Location: "https://www.googleapis.com/upload/x?upload_id=1" } })
        : new Response(JSON.stringify({ error: { code: 403, message: "storageQuotaExceeded" } }), { status: 403 })
    );
    await expect(
      directUpload(TOKEN, "drive", "files", "create", {
        contentType: "application/octet-stream",
        source: chunks(RESUMABLE_CHUNK + 5, 1 << 20),
      })
    ).rejects.toThrow(/API error: .*storageQuotaExceeded/);
  });
});

describe("gmailAttachmentBytes reads the data field out of the stream", () => {
  const original = expected(100_001);
  const document = JSON.stringify({ size: original.length, data: original.toString("base64url") });

  async function decode(pieces: string[]): Promise<Buffer> {
    async function* feed() {
      for (const p of pieces) yield Buffer.from(p);
    }
    const out: Buffer[] = [];
    for await (const b of gmailAttachmentBytes(feed())) out.push(Buffer.from(b));
    return Buffer.concat(out);
  }

  it.each([1, 3, 7, 4096, 65_537])("decodes exactly, whatever the network chunk size (%i)", async (size) => {
    const pieces: string[] = [];
    for (let i = 0; i < document.length; i += size) pieces.push(document.slice(i, i + size));
    expect((await decode(pieces)).equals(original)).toBe(true);
  });

  it("handles the field coming first, and whitespace around the colon", async () => {
    const doc = `{ "data" : "${original.toString("base64url")}", "size": 1 }`;
    expect((await decode([doc.slice(0, 5), doc.slice(5)])).equals(original)).toBe(true);
  });

  it("says so when there is no data", async () => {
    await expect(decode(['{"size":0}'])).rejects.toThrow(/No attachment data/);
  });
});
