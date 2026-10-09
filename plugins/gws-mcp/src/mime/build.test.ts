import { describe, expect, it } from "vitest";
import { simpleParser, type ParsedMail } from "mailparser";
import { base64Lines, buildMessage, fileParam, safeFilename, safeMimeType, type ByteAttachment } from "./build.js";

async function drain(stream: AsyncIterable<Buffer | Uint8Array | string>): Promise<Buffer> {
  const held: Buffer[] = [];
  for await (const c of stream) held.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(held);
}

async function* bytesOf(buf: Buffer, step = 1000): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < buf.length; i += step) yield buf.subarray(i, i + step);
}

const pattern = (n: number) => {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = (i * 7) % 256;
  return b;
};

function file(over: Partial<ByteAttachment> & { bytes?: Buffer } = {}): ByteAttachment {
  const bytes = over.bytes ?? pattern(5000);
  return {
    filename: "report.bin",
    mimeType: "application/octet-stream",
    contentId: over.filename ?? "report.bin",
    disposition: "attachment",
    open: () => bytesOf(bytes, 777),
    ...over,
  };
}

const HEADERS = ["To: a@example.com", "Subject: hi"];

async function parse(headers: string[], bodies: { plain: string; html?: string }, files: ByteAttachment[]) {
  const raw = await drain(buildMessage(headers, bodies, files));
  return { raw, mail: (await simpleParser(raw)) as ParsedMail };
}

describe("buildMessage", () => {
  it("attached only: multipart/mixed, body first, then the file with its exact bytes", async () => {
    const bytes = pattern(12_345);
    const { raw, mail } = await parse(HEADERS, { plain: "hello", html: "<p>hello</p>" }, [file({ bytes })]);
    expect(raw.toString("latin1")).toMatch(/^To: a@example\.com\r\nSubject: hi\r\nMIME-Version: 1\.0\r\nContent-Type: multipart\/mixed;/);
    expect(mail.text?.trim()).toBe("hello");
    expect(mail.html).toContain("<p>hello</p>");
    expect(mail.attachments).toHaveLength(1);
    const [a] = mail.attachments;
    expect(a.filename).toBe("report.bin");
    expect(a.contentDisposition).toBe("attachment");
    expect(a.content.equals(bytes)).toBe(true);
  });

  it("inline only: multipart/related with the image in place and nothing in mixed", async () => {
    const png = pattern(3000);
    const { raw, mail } = await parse(
      HEADERS,
      { plain: "see chart", html: '<p>see</p><img src="cid:chart.png">' },
      [file({ filename: "chart.png", mimeType: "image/png", contentId: "chart.png", disposition: "inline", bytes: png })]
    );
    const text = raw.toString("latin1");
    expect(text).toMatch(/Content-Type: multipart\/related; boundary="[^"]+"; type="multipart\/alternative"/);
    expect(text).not.toMatch(/multipart\/mixed/);
    const [a] = mail.attachments;
    expect(a.contentDisposition).toBe("inline");
    expect(a.cid).toBe("chart.png");
    expect(a.related).toBe(true);
    expect(a.content.equals(png)).toBe(true);
  });

  it("one inline and one attached: mixed wraps related, each file once, in its own place", async () => {
    const { raw, mail } = await parse(
      HEADERS,
      { plain: "x", html: '<img src="cid:a.png">' },
      [
        file({ filename: "a.png", mimeType: "image/png", contentId: "a.png", disposition: "inline", bytes: pattern(100) }),
        file({ filename: "b.pdf", mimeType: "application/pdf", contentId: "b.pdf", bytes: pattern(200) }),
      ]
    );
    const text = raw.toString("latin1");
    const mixed = text.indexOf("multipart/mixed");
    const related = text.indexOf("multipart/related");
    expect(mixed).toBeGreaterThan(-1);
    expect(related).toBeGreaterThan(mixed);
    expect(mail.attachments.map((a) => [a.filename, a.contentDisposition])).toEqual([
      ["a.png", "inline"],
      ["b.pdf", "attachment"],
    ]);
    expect(text.match(/filename="a\.png"/g)).toHaveLength(1);
  });

  it("a plain-only body with a file keeps text/plain as the first part", async () => {
    const { mail } = await parse(HEADERS, { plain: "just text" }, [file()]);
    expect(mail.text?.trim()).toBe("just text");
    expect(mail.html).toBe(false);
    expect(mail.attachments).toHaveLength(1);
  });

  it("non-ASCII and long filenames round-trip through RFC 2231 and keep every header line short", async () => {
    const name = "Résumé – 季度报告 " + "x".repeat(150) + ".pdf";
    const { raw, mail } = await parse(HEADERS, { plain: "x" }, [file({ filename: name, mimeType: "application/pdf" })]);
    expect(mail.attachments[0].filename).toBe(name);
    for (const line of raw.toString("latin1").split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
  });

  it("a filename or mime type carrying a line break cannot add a header", async () => {
    const { raw, mail } = await parse(HEADERS, { plain: "x" }, [
      file({ filename: "a.txt\r\nBcc: evil@example.com", mimeType: "text/plain\r\nBcc: evil@example.com" }),
    ]);
    expect(raw.toString("latin1")).not.toMatch(/\r\nBcc:/i);
    expect(mail.bcc).toBeUndefined();
    expect(mail.attachments[0].contentType).toBe("application/octet-stream");
  });

  it("base64 lines are 76 columns and reassemble exactly across uneven chunk edges", async () => {
    const bytes = pattern(57 * 3 + 5);
    const out = (await drain(base64Lines(bytesOf(bytes, 10)))).toString("latin1");
    const lines = out.split("\r\n").filter(Boolean);
    expect(lines.slice(0, -1).every((l) => l.length === 76)).toBe(true);
    expect(Buffer.from(lines.join(""), "base64").equals(bytes)).toBe(true);
  });

  it("reads a source only when the stream reaches it", async () => {
    let opened = 0;
    const stream = buildMessage(HEADERS, { plain: "x" }, [
      file({ open: () => { opened++; return bytesOf(pattern(10)); } }),
    ]);
    expect(opened).toBe(0);
    await drain(stream);
    expect(opened).toBe(1);
  });

  it("a source that fails mid-stream fails the stream, so a half message is never finished", async () => {
    async function* broken(): AsyncGenerator<Uint8Array> {
      yield pattern(100);
      throw new Error("download failed");
    }
    await expect(drain(buildMessage(HEADERS, { plain: "x" }, [file({ open: broken })]))).rejects.toThrow("download failed");
  });
});

describe("header value guards", () => {
  it("safeMimeType keeps a token pair and refuses anything with parameters or quotes", () => {
    expect(safeMimeType("image/PNG")).toBe("image/png");
    expect(safeMimeType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(safeMimeType('text/html; charset="x"')).toBe("application/octet-stream");
    expect(safeMimeType(undefined)).toBe("application/octet-stream");
  });

  it("safeFilename drops control characters and path separators, never returns empty", () => {
    expect(safeFilename("a\u0000b\tc/d\\e.txt")).toBe("abc_d_e.txt");
    expect(safeFilename("\r\n")).toBe("attachment");
  });

  it("fileParam quotes short ASCII and escapes a quote", () => {
    expect(fileParam("filename", 'say "hi".txt')).toBe('filename="say \\"hi\\".txt"');
  });
});
