import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from "undici";
import { GwsClient } from "../../gws-client.js";
import { fakeClient } from "../../tools/fake-client.test-helper.js";
import { RESOLVERS, handleFileBytes } from "../file-bytes.js";
import { ATTACHMENT_FIELDS, attachmentName } from "./gmail-attachment.js";
import { MAX_NAME_LENGTH, type FileBytesResponse } from "./shared.js";

const TOKEN = "test-bearer-file-bytes";
const ID = "18c2f0a9b7d3e411";
// What Gmail issued for each part on THIS read. No ref ever carries one.
const PDF_ATTACHMENT = "ANGjdJ8pdf_issued-on-this-read";
const PNG_ATTACHMENT = "ANGjdJ9png_issued-on-this-read";

type Plan = Parameters<typeof fakeClient>[0];
type Part = Record<string, unknown>;

/** A message as Gmail lays one out: the text alternatives first, then a
 * forwarded bundle whose own parts are the attachments. */
const message = (over: { pdf?: Part; png?: Part } = {}) => ({
  data: {
    payload: {
      partId: "",
      mimeType: "multipart/mixed",
      filename: "",
      body: { size: 0 },
      parts: [
        {
          partId: "0",
          mimeType: "multipart/alternative",
          filename: "",
          body: { size: 0 },
          parts: [
            { partId: "0.0", mimeType: "text/plain", filename: "", body: { size: 33 } },
            { partId: "0.1", mimeType: "text/html", filename: "", body: { size: 398 } },
          ],
        },
        {
          partId: "1",
          mimeType: "multipart/mixed",
          filename: "",
          body: { size: 0 },
          parts: [
            {
              partId: "1.0",
              mimeType: "application/pdf",
              filename: "Quarterly report.pdf",
              body: { attachmentId: PDF_ATTACHMENT, size: 5000 },
              ...over.pdf,
            },
            {
              partId: "1.1",
              mimeType: "image/png",
              filename: "chart.png",
              body: { attachmentId: PNG_ATTACHMENT, size: 1200 },
              ...over.png,
            },
          ],
        },
      ],
    },
  },
});
const dataAnswer = (bytes: Buffer) => ({ text: JSON.stringify({ data: bytes.toString("base64url") }) });

const request = (ref: unknown, maxBytes: unknown = 1_000_000) => JSON.stringify({ ref, max_bytes: maxBytes });
const pdfRef = { type: "gmail_attachment", message_id: ID, part_id: "1.0" };
const pngRef = { type: "gmail_attachment", message_id: ID, part_id: "1.1" };

async function run(plan: Plan, body = request(pdfRef)) {
  const { client, calls } = fakeClient(plan);
  const res = await handleFileBytes({ method: "POST", token: TOKEN, body }, () => client);
  return { res, calls };
}

const errorOf = (res: FileBytesResponse) => JSON.parse(res.body.toString("utf8")) as { error: string; code: string };
const nameOf = (res: FileBytesResponse) => decodeURIComponent(res.headers["X-File-Name"]);
const downloads = (calls: Array<Record<string, unknown>>) => calls.filter((c) => c.download === true);

describe("a Gmail attachment as the bytes the sender attached", () => {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n", "latin1"), Buffer.from([0x00, 0xff, 0xfe, 0x0d, 0x0a, 0x80])]);

  it("finds a nested part by its part id and answers with its bytes, type, length and name", async () => {
    const { res, calls } = await run([message(), dataAnswer(pdf)]);
    expect(res.status).toBe(200);
    expect(res.code).toBe("ok");
    expect(res.body.equals(pdf)).toBe(true);
    expect(res.headers["Content-Type"]).toBe("application/pdf");
    expect(res.headers["Content-Length"]).toBe(String(pdf.length));
    expect(nameOf(res)).toBe("Quarterly report.pdf");

    // The part is read first, then its bytes by the id THAT read returned.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      service: "gmail",
      resource: "users.messages",
      method: "get",
      params: { userId: "me", id: ID, format: "full", fields: ATTACHMENT_FIELDS },
    });
    expect(calls[1]).toMatchObject({
      download: true,
      service: "gmail",
      resource: "users.messages.attachments",
      method: "get",
      params: { userId: "me", messageId: ID, id: PDF_ATTACHMENT, fields: "data" },
    });
  });

  it("a sibling part id is a different attachment", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { res, calls } = await run([message(), dataAnswer(png)], request(pngRef));
    expect(res.body.equals(png)).toBe(true);
    expect(res.headers["Content-Type"]).toBe("image/png");
    expect(nameOf(res)).toBe("chart.png");
    expect((calls[1].params as { id: string }).id).toBe(PNG_ATTACHMENT);
  });

  it("an attachment id in the ref is ignored: only the part id chooses", async () => {
    const stale = { ...pdfRef, attachment_id: PNG_ATTACHMENT };
    const { res, calls } = await run([message(), dataAnswer(pdf)], request(stale));
    expect(res.status).toBe(200);
    expect((calls[1].params as { id: string }).id).toBe(PDF_ATTACHMENT);
  });

  it("the field mask names the part fields at every level it writes out, and balances", () => {
    expect(ATTACHMENT_FIELDS.startsWith("payload(partId,filename,mimeType,body(attachmentId,size),parts(")).toBe(true);
    expect(ATTACHMENT_FIELDS.split("(").length).toBe(ATTACHMENT_FIELDS.split(")").length);
    expect(ATTACHMENT_FIELDS).not.toMatch(/data|headers/);
  });
});

describe("no attachment at that part", () => {
  it.each([
    ["a part id the message does not have", "7"],
    ["a deeper id under a real part", "1.0.0"],
    ["a text part, which has no attachment id", "0.0"],
    ["a container part", "1"],
  ])("404 not_found for %s, and nothing is fetched", async (_label, partId) => {
    const { res, calls } = await run([message()], request({ ...pdfRef, part_id: partId }));
    expect(res.status).toBe(404);
    expect(errorOf(res)).toEqual({ code: "not_found", error: "The message has no attachment at that part." });
    expect(calls).toHaveLength(1);
  });

  it("404 for a message with no payload at all", async () => {
    for (const data of [{}, undefined, { payload: { partId: "" } }]) {
      const { res } = await run([{ data }]);
      expect(res.status).toBe(404);
      expect(errorOf(res).code).toBe("not_found");
    }
  });

  it("a part list holding something that is not a part is stepped over, and the first match in message order wins", async () => {
    const wanted = { partId: "2", filename: "first.txt", mimeType: "text/plain", body: { attachmentId: PDF_ATTACHMENT, size: 1 } };
    const later = { partId: "2", filename: "second.txt", mimeType: "text/plain", body: { attachmentId: PNG_ATTACHMENT, size: 1 } };
    const data = { payload: { partId: "", parts: [null, "text", 7, { partId: "1", parts: [wanted] }, later] } };
    const { res, calls } = await run([{ data }, dataAnswer(Buffer.from("x"))], request({ ...pdfRef, part_id: "2" }));
    expect(res.status).toBe(200);
    expect(nameOf(res)).toBe("first.txt");
    expect((calls[1].params as { id: string }).id).toBe(PDF_ATTACHMENT);
  });

  it("a message with a very wide part list is searched without failing", async () => {
    const parts: Part[] = Array.from({ length: 200_000 }, (_, i) => ({ partId: `0.${i}` }));
    parts.push({ partId: "9", filename: "last.txt", body: { attachmentId: PDF_ATTACHMENT, size: 1 } });
    const { res } = await run([{ data: { payload: { partId: "", parts } } }, dataAnswer(Buffer.from("x"))], request({ ...pdfRef, part_id: "9" }));
    expect(res.status).toBe(200);
    expect(nameOf(res)).toBe("last.txt");
  });

  it("an attachment id that could not go into a URL path is not fetched", async () => {
    const { res, calls } = await run([message({ pdf: { body: { attachmentId: "a/../b?x=1", size: 10 } } })]);
    expect(res.status).toBe(404);
    expect(downloads(calls)).toHaveLength(0);
  });
});

describe("the size cap", () => {
  const body = Buffer.alloc(5000, 0x61);

  it("refuses by the part's size WITHOUT fetching the bytes, stating both sizes in MB", async () => {
    const cap = 10 * 1024 * 1024;
    const { res, calls } = await run(
      [message({ pdf: { body: { attachmentId: PDF_ATTACHMENT, size: 26_843_546 } } }), dataAnswer(body)],
      request(pdfRef, cap)
    );
    expect(res.status).toBe(413);
    expect(errorOf(res)).toEqual({
      code: "too_large",
      error: "The attachment is 25.6 MB, which is over the 10.0 MB limit for one file.",
    });
    expect(downloads(calls)).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("a size equal to the cap is allowed through to the read", async () => {
    const { res, calls } = await run([message(), dataAnswer(body)], request(pdfRef, 5000));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(5000);
    expect(downloads(calls)).toHaveLength(1);
  });

  it("refuses mid-stream when the part said it was under the cap but the bytes are over it", async () => {
    const { res, calls } = await run(
      [message({ pdf: { body: { attachmentId: PDF_ATTACHMENT, size: 4000 } } }), dataAnswer(body)],
      request(pdfRef, 4999)
    );
    expect(res.status).toBe(413);
    expect(errorOf(res).code).toBe("too_large");
    expect(errorOf(res).error).toMatch(/^The attachment is .* MB.* MB/);
    expect(downloads(calls)).toHaveLength(1);
    expect(res.headers["Content-Type"]).toBe("application/json");
  });

  it("refuses mid-stream when the part carried no size at all", async () => {
    const { res } = await run([message({ pdf: { body: { attachmentId: PDF_ATTACHMENT } } }), dataAnswer(body)], request(pdfRef, 100));
    expect(res.status).toBe(413);
  });
});

describe("refusals before any call to Gmail", () => {
  it.each([
    ["no part_id", { type: "gmail_attachment", message_id: ID }],
    ["an attachment_id in place of a part_id", { type: "gmail_attachment", message_id: ID, attachment_id: PDF_ATTACHMENT }],
    ["an empty part_id", { ...pdfRef, part_id: "" }],
    ["a part_id that is a number", { ...pdfRef, part_id: 1 }],
    ["a part_id with a letter", { ...pdfRef, part_id: "1a" }],
    ["a part_id ending in a dot", { ...pdfRef, part_id: "1." }],
    ["a part_id starting with a dot", { ...pdfRef, part_id: ".1" }],
    ["a part_id with two dots together", { ...pdfRef, part_id: "1..2" }],
    ["a part_id with a slash", { ...pdfRef, part_id: "1/2" }],
    ["a part_id ending in a newline", { ...pdfRef, part_id: "1\n" }],
    ["no message_id", { type: "gmail_attachment", part_id: "1" }],
    ["a message_id with a slash", { ...pdfRef, message_id: "abc/def" }],
    ["a message_id with a query", { ...pdfRef, message_id: "abc?format=raw" }],
  ])("400 bad_request for %s", async (_label, ref) => {
    const { res, calls } = await run([], request(ref));
    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe("bad_request");
    expect(calls).toHaveLength(0);
  });

  it("says which field is wrong", async () => {
    const part = await run([], request({ ...pdfRef, part_id: "x" }));
    expect(errorOf(part.res).error).toContain("ref.part_id");
    const id = await run([], request({ ...pdfRef, message_id: "" }));
    expect(errorOf(id.res).error).toContain("ref.message_id");
  });
});

describe("failures from Gmail", () => {
  const notFound = 'API error: {"error":{"code":404,"message":"Requested entity was not found.","reason":"notFound"}}';
  const forbidden = 'API error: {"error":{"code":403,"message":"Request had insufficient authentication scopes.","reason":"insufficientPermissions"}}';

  it("404 not_found when the message does not exist", async () => {
    const { res, calls } = await run([{ throws: notFound }]);
    expect(res.status).toBe(404);
    expect(errorOf(res)).toEqual({ code: "not_found", error: "Gmail has no message with that id in this mailbox." });
    expect(downloads(calls)).toHaveLength(0);
  });

  it("404 not_found when the message disappears between the two reads", async () => {
    const { res } = await run([message(), { throws: notFound }]);
    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe("not_found");
  });

  it("502 upstream with Google's own message for any other failure, on either read", async () => {
    const first = await run([{ throws: forbidden }]);
    expect(first.res.status).toBe(502);
    expect(errorOf(first.res)).toEqual({
      code: "upstream",
      error: "Gmail could not return the attachment: Request had insufficient authentication scopes.",
    });
    const second = await run([message(), { throws: forbidden }]);
    expect(second.res.status).toBe(502);
    expect(errorOf(second.res).code).toBe("upstream");
    const plain = await run([{ throws: "gmail users.messages get: the request timed out" }]);
    expect(plain.res.status).toBe(502);
    expect(errorOf(plain.res).error).toContain("timed out");
  });

  it("502 upstream when the answer carries no data field, or an empty one", async () => {
    for (const text of [JSON.stringify({ size: 5000 }), JSON.stringify({ data: "" })]) {
      const { res } = await run([message(), { text }]);
      expect(res.status).toBe(502);
      expect(errorOf(res).code).toBe("upstream");
    }
  });
});

describe("the file name and type", () => {
  const one = Buffer.from("x");
  const named = async (pdf: Part) => (await run([message({ pdf }), dataAnswer(one)])).res;

  it("an empty file name falls back to the part id, with an extension when the type has one", async () => {
    expect(nameOf(await named({ filename: "" }))).toBe("attachment-1.0.pdf");
    expect(nameOf(await named({ filename: undefined, mimeType: "IMAGE/PNG" }))).toBe("attachment-1.0.png");
    expect(nameOf(await named({ filename: "   ", mimeType: "application/x-unheard-of" }))).toBe("attachment-1.0");
    expect(nameOf(await named({ filename: "", mimeType: "" }))).toBe("attachment-1.0");
  });

  it("a name that is only dots, or only refused characters, is not a name", () => {
    for (const filename of ["..", ".", '\\/:*?"<>|', "\u0000\u0001"]) {
      expect(attachmentName(filename, "2", "text/csv")).toBe("attachment-2.csv");
    }
  });

  it("separators and control characters are removed, so a name is never a path", () => {
    expect(attachmentName("../../etc/passwd", "1", undefined)).toBe("....etcpasswd");
    expect(attachmentName("C:\\Users\\a\\report.pdf", "1", undefined)).toBe("CUsersareport.pdf");
    expect(attachmentName("a\r\nSet-Cookie: x.pdf", "1", undefined)).toBe("a Set-Cookie x.pdf");
    expect(attachmentName("  Résumé  ☃.docx ", "1", undefined)).toBe("Résumé ☃.docx");
  });

  it("direction marks are removed, so an extension cannot be made to read as another", () => {
    expect(attachmentName("invoice\u202efdp.exe", "1", undefined)).toBe("invoicefdp.exe");
    expect(attachmentName("\u2066a\u2069\u200e\u200f\u061c.txt", "1", undefined)).toBe("a.txt");
    // A joiner inside an emoji is not a direction mark and stays.
    expect(attachmentName("👩\u200d💻.png", "1", undefined)).toBe("👩\u200d💻.png");
  });

  it("a very long name is bounded before it is cleaned, and a prototype key is not a type", () => {
    const started = Date.now();
    const name = attachmentName(" \t".repeat(5_000_000) + "x.pdf", "1", "application/pdf");
    expect(Date.now() - started).toBeLessThan(500);
    expect(name).toBe("attachment-1.pdf");
    expect(attachmentName("", "1", "constructor")).toBe("attachment-1");
  });

  it("a long name is cut to 200 characters with the extension kept whole", () => {
    const name = attachmentName("word ".repeat(100) + "final.xlsx", "1", undefined);
    expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(name.length).toBeGreaterThan(MAX_NAME_LENGTH - 6);
    expect(name.endsWith(".xlsx")).toBe(true);
    expect(name.startsWith("word word")).toBe(true);
    expect(name).not.toMatch(/ \./);
  });

  it("a name that fits exactly is not cut, and one character more is", () => {
    const fits = "s".repeat(MAX_NAME_LENGTH - 4);
    expect(attachmentName(fits + ".pdf", "1", undefined)).toBe(fits + ".pdf");
    const over = attachmentName(fits + "X.pdf", "1", undefined);
    expect(over).toBe(fits + ".pdf");
    expect(over.length).toBe(MAX_NAME_LENGTH);
  });

  it("an ending too long to be an extension, or holding a space, is cut like the rest", () => {
    const long = attachmentName("a".repeat(250) + "." + "b".repeat(40), "1", undefined);
    expect(long.length).toBe(MAX_NAME_LENGTH);
    expect(attachmentName("v1. final draft", "1", undefined)).toBe("v1. final draft");
    expect(attachmentName(".gitignore", "1", undefined)).toBe(".gitignore");
  });

  it("a cut never leaves half of a surrogate pair, so the header can always be encoded", () => {
    for (let pad = 0; pad < 4; pad++) {
      const name = attachmentName("a".repeat(pad) + "📎".repeat(150) + ".pdf", "1", undefined);
      expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      expect(name.endsWith(".pdf")).toBe(true);
      expect(name.isWellFormed()).toBe(true);
      expect(() => encodeURIComponent(name)).not.toThrow();
    }
    expect(() => encodeURIComponent(attachmentName("bad \ud83d end.pdf", "1", undefined))).not.toThrow();
  });

  it("a non-ASCII name is percent-encoded in the header and decodes back", async () => {
    const res = await named({ filename: "Résumé ☃.pdf" });
    expect(res.headers["X-File-Name"]).toMatch(/^[\x21-\x7e]+$/);
    expect(nameOf(res)).toBe("Résumé ☃.pdf");
  });

  it("the type is the part's, and application/octet-stream when it is blank or not a type", async () => {
    expect((await named({ mimeType: "text/csv" })).headers["Content-Type"]).toBe("text/csv");
    for (const mimeType of ["", undefined, 42, "pdf", "text/plain; charset=utf-8", "text/plain\r\nX-Injected: 1", `text/${"x".repeat(300)}`]) {
      const res = await named({ mimeType });
      expect(res.status).toBe(200);
      expect(res.headers["Content-Type"]).toBe("application/octet-stream");
    }
  });
});

describe("the registry of reference types", () => {
  it("the unsupported-type text lists every registered type", async () => {
    const { res, calls } = await run([], request({ type: "drive_file", file_id: "abc" }));
    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual({
      code: "unsupported_ref",
      error: `This reference type is not supported. Supported: ${Object.keys(RESOLVERS).join(", ")}.`,
    });
    expect(errorOf(res).error).toContain("gmail_message, gmail_attachment");
    expect(calls).toHaveLength(0);
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty", "Gmail_Attachment", ""])(
    "%j is not a type, though every object has it",
    async (type) => {
      const { res } = await run([], request({ type, message_id: ID, part_id: "1" }));
      expect(res.status).toBe(400);
      expect(errorOf(res).code).toBe("unsupported_ref");
    }
  );

  it("a type that is an array naming a real type is not that type", async () => {
    const { res } = await run([], request({ type: ["gmail_attachment"], message_id: ID, part_id: "1" }));
    expect(errorOf(res).code).toBe("unsupported_ref");
  });
});

/**
 * The same route through the real client and Node's real fetch, with an
 * undici MockAgent answering as Gmail does: what goes on the wire, and what
 * the transport's errors look like.
 */
describe("through the real transport", () => {
  const GMAIL = "https://gmail.googleapis.com";
  let previous: Dispatcher;
  let agent: MockAgent;

  beforeEach(() => {
    previous = getGlobalDispatcher();
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  afterEach(async () => {
    setGlobalDispatcher(previous);
    await agent.close();
  });

  const call = (maxBytes = 1_000_000) =>
    handleFileBytes(
      { method: "POST", token: TOKEN, body: request(pdfRef, maxBytes) },
      (accessToken) => new GwsClient({ accessToken })
    );
  const isMessage = (p: string) => p.includes("format=full");
  const isAttachment = (p: string) => p.includes("/attachments/");

  it("reads the parts with the mask, then the data field of the attachment that read named", async () => {
    const pdf = Buffer.alloc(300_000);
    for (let i = 0; i < pdf.length; i++) pdf[i] = (i * 31 + 7) % 256;
    const seen: Array<{ path: string; auth: string }> = [];
    const authOf = (headers: unknown) =>
      String((headers as Record<string, string>).authorization ?? (headers as Record<string, string>).Authorization);
    const pool = agent.get(GMAIL);
    pool.intercept({ path: isMessage, method: "GET" }).reply(
      200,
      (opts) => {
        seen.push({ path: opts.path, auth: authOf(opts.headers) });
        return message({ pdf: { body: { attachmentId: PDF_ATTACHMENT, size: pdf.length } } }).data;
      },
      { headers: { "content-type": "application/json" } }
    );
    pool.intercept({ path: isAttachment, method: "GET" }).reply(
      200,
      (opts) => {
        seen.push({ path: opts.path, auth: authOf(opts.headers) });
        return JSON.stringify({ data: pdf.toString("base64url") }, null, 2);
      },
      { headers: { "content-type": "application/json" } }
    );

    const res = await call();
    expect(res.status).toBe(200);
    expect(res.body.equals(pdf)).toBe(true);
    expect(nameOf(res)).toBe("Quarterly report.pdf");

    expect(seen).toHaveLength(2);
    const first = new URL(GMAIL + seen[0].path);
    expect(first.pathname).toBe(`/gmail/v1/users/me/messages/${ID}`);
    expect(first.searchParams.get("fields")).toBe(ATTACHMENT_FIELDS);
    const second = new URL(GMAIL + seen[1].path);
    // The transport percent-encodes _ and - in a path value, as the CLI does.
    expect(decodeURIComponent(second.pathname)).toBe(`/gmail/v1/users/me/messages/${ID}/attachments/${PDF_ATTACHMENT}`);
    expect(second.searchParams.get("fields")).toBe("data");
    expect(second.searchParams.get("alt")).toBeNull();
    // The token is in the Authorization header of both and in neither URL.
    expect(seen.map((s) => s.auth)).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
    expect(seen.map((s) => s.path).join(" ")).not.toContain(TOKEN);
  });

  it("Gmail's 404 is not_found, and the answer never carries the token", async () => {
    agent
      .get(GMAIL)
      .intercept({ path: isMessage, method: "GET" })
      .reply(404, { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } });
    const res = await call();
    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe("not_found");
    expect(res.body.toString("utf8")).not.toContain(TOKEN);
  });

  it("any other Gmail failure on the attachment read is upstream with Google's message", async () => {
    const pool = agent.get(GMAIL);
    pool.intercept({ path: isMessage, method: "GET" }).reply(200, message().data, { headers: { "content-type": "application/json" } });
    pool
      .intercept({ path: isAttachment, method: "GET" })
      .reply(400, { error: { code: 400, message: "Invalid attachment token", status: "INVALID_ARGUMENT" } });
    const res = await call();
    expect(res.status).toBe(502);
    expect(errorOf(res)).toEqual({ code: "upstream", error: "Gmail could not return the attachment: Invalid attachment token" });
    expect(res.body.toString("utf8")).not.toContain(TOKEN);
  });

  it("an over-cap part sends one request and no second", async () => {
    agent
      .get(GMAIL)
      .intercept({ path: isMessage, method: "GET" })
      .reply(200, message({ pdf: { body: { attachmentId: PDF_ATTACHMENT, size: 9_000_000 } } }).data, {
        headers: { "content-type": "application/json" },
      });
    // No attachment interceptor: with the network disabled, a second read
    // would fail as upstream instead of answering 413.
    const res = await call(1_000_000);
    expect(res.status).toBe(413);
    expect(errorOf(res).code).toBe("too_large");
  });
});
