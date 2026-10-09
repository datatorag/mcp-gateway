import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from "undici";
import { GwsClient } from "../gws-client.js";
import { fakeClient } from "../tools/fake-client.test-helper.js";
import {
  MAX_NAME_LENGTH,
  fileNameFor,
  handleFileBytes,
  sanitiseSubject,
  type FileBytesResponse,
} from "./file-bytes.js";

const TOKEN = "test-bearer-file-bytes";
const ID = "18c2f0a9b7d3e411";
// 2026-03-09T23:30:00Z: a UTC date that is already the 10th east of UTC+1.
const INTERNAL_DATE = String(Date.UTC(2026, 2, 9, 23, 30));

type Plan = Parameters<typeof fakeClient>[0];

const metadata = (over: Record<string, unknown> = {}) => ({
  data: {
    id: ID,
    sizeEstimate: 1200,
    internalDate: INTERNAL_DATE,
    payload: { headers: [{ name: "Date", value: "Mon, 9 Mar 2026 23:30:00 +0000" }, { name: "Subject", value: "Quarterly report" }] },
    ...over,
  },
});
const rawAnswer = (bytes: Buffer) => ({ text: JSON.stringify({ raw: bytes.toString("base64url") }) });

const request = (ref: unknown, maxBytes: unknown = 1_000_000) =>
  JSON.stringify({ ref, max_bytes: maxBytes });
const gmailRef = { type: "gmail_message", message_id: ID };

async function run(plan: Plan, body = request(gmailRef), over: { method?: string; token?: string | undefined } = {}) {
  const { client, calls } = fakeClient(plan);
  const seenTokens: string[] = [];
  const res = await handleFileBytes(
    { method: "method" in over ? over.method : "POST", token: "token" in over ? over.token : TOKEN, body },
    (token) => {
      seenTokens.push(token);
      return client;
    }
  );
  return { res, calls, seenTokens };
}

const errorOf = (res: FileBytesResponse) => JSON.parse(res.body.toString("utf8")) as { error: string; code: string };
const rawCalls = (calls: Array<Record<string, unknown>>) => calls.filter((c) => c.download === true);

describe("a Gmail message as its original bytes", () => {
  const eml = Buffer.from("From: a@example.com\r\nSubject: Quarterly report\r\n\r\nHello\r\n", "utf8");

  it("answers 200 with exactly the decoded bytes, the type, the length and the name", async () => {
    const { res, calls, seenTokens } = await run([metadata(), rawAnswer(eml)]);
    expect(res.status).toBe(200);
    expect(res.body.equals(eml)).toBe(true);
    expect(res.headers["Content-Type"]).toBe("message/rfc822");
    expect(res.headers["Content-Length"]).toBe(String(eml.length));
    expect(decodeURIComponent(res.headers["X-File-Name"])).toBe(`Quarterly report 2026-03-09 ${ID}.eml`);
    expect(res.headers["X-File-Name"]).toBe(encodeURIComponent(`Quarterly report 2026-03-09 ${ID}.eml`));
    expect(seenTokens).toEqual([TOKEN]);

    // The size is asked for first, then the bytes, and nothing else.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      service: "gmail",
      resource: "users.messages",
      method: "get",
      params: { userId: "me", id: ID, format: "metadata", metadataHeaders: ["Subject", "Date"] },
    });
    expect(calls[1]).toMatchObject({
      download: true,
      service: "gmail",
      resource: "users.messages",
      method: "get",
      params: { userId: "me", id: ID, format: "raw", fields: "raw" },
    });
  });

  it("CRLF, a bare LF, a bare CR, a NUL and non-ASCII bytes all survive unchanged", async () => {
    const tricky = Buffer.concat([
      Buffer.from("Subject: café ☃ 📧\r\n", "utf8"),
      Buffer.from("X-Bare-LF: one\ntwo\n", "utf8"),
      Buffer.from([0x0d, 0x41, 0x00, 0xff, 0xfe, 0x80, 0x0a, 0x0d, 0x0a]),
      Buffer.from("line with trailing space \r\n\r\n", "latin1"),
      Buffer.from([0xe9, 0xe8, 0x0a]), // latin-1 text that is not valid UTF-8
    ]);
    const { res } = await run([metadata(), rawAnswer(tricky)]);
    expect(res.status).toBe(200);
    expect(res.body.equals(tricky)).toBe(true);
    expect(res.headers["Content-Length"]).toBe(String(tricky.length));
  });

  it("decodes padded base64url and a body that arrives after other fields", async () => {
    const padded = Buffer.from(eml).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
    const { res } = await run([metadata(), { text: `{\n  "id": "${ID}",\n  "raw": "${padded}"\n}\n` }]);
    expect(res.body.equals(eml)).toBe(true);
  });
});

describe("the size cap", () => {
  const body = Buffer.alloc(5000, 0x61);

  it("refuses by sizeEstimate WITHOUT reading the raw message, stating both sizes in MB", async () => {
    const cap = 10 * 1024 * 1024;
    const { res, calls } = await run([metadata({ sizeEstimate: 26_843_546 }), rawAnswer(body)], request(gmailRef, cap));
    expect(res.status).toBe(413);
    expect(errorOf(res)).toEqual({
      code: "too_large",
      error: "The message is 25.6 MB, which is over the 10.0 MB limit for one file.",
    });
    expect(rawCalls(calls)).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("a sizeEstimate equal to the cap is allowed through to the read", async () => {
    const { res, calls } = await run([metadata({ sizeEstimate: 5000 }), rawAnswer(body)], request(gmailRef, 5000));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(5000);
    expect(rawCalls(calls)).toHaveLength(1);
  });

  it("refuses after decoding when the estimate was under the cap but the bytes are over it", async () => {
    const { res, calls } = await run([metadata({ sizeEstimate: 4000 }), rawAnswer(body)], request(gmailRef, 4999));
    expect(res.status).toBe(413);
    expect(errorOf(res).code).toBe("too_large");
    expect(errorOf(res).error).toMatch(/MB.*MB/);
    expect(rawCalls(calls)).toHaveLength(1);
    expect(res.headers["Content-Type"]).toBe("application/json");
  });

  it("refuses after decoding when Gmail gave no sizeEstimate at all", async () => {
    const { res } = await run([metadata({ sizeEstimate: undefined }), rawAnswer(body)], request(gmailRef, 100));
    expect(res.status).toBe(413);
  });
});

describe("refusals before any call to Gmail", () => {
  const untouched = async (body: string, over: { method?: string; token?: string | undefined } = {}) => {
    const { res, calls, seenTokens } = await run([], body, over);
    expect(calls).toHaveLength(0);
    expect(seenTokens).toHaveLength(0);
    return res;
  };

  it("401 no_token when the header is missing or empty", async () => {
    for (const token of [undefined, ""]) {
      const res = await untouched(request(gmailRef), { token });
      expect(res.status).toBe(401);
      expect(errorOf(res).code).toBe("no_token");
    }
  });

  it.each(["GET", "PUT", "DELETE", "HEAD", undefined])("405 for %s", async (method) => {
    const res = await untouched(request(gmailRef), { method });
    expect(res.status).toBe(405);
    expect(res.headers.Allow).toBe("POST");
  });

  it.each([
    ["a body that is not JSON", "{not json"],
    ["an empty body", ""],
    ["a JSON array", "[]"],
    ["a JSON null", "null"],
    ["no ref", JSON.stringify({ max_bytes: 10 })],
    ["a ref that is a string", JSON.stringify({ ref: "gmail_message", max_bytes: 10 })],
    ["a missing message_id", request({ type: "gmail_message" })],
    ["an empty message_id", request({ type: "gmail_message", message_id: "" })],
    ["a message_id that is a number", request({ type: "gmail_message", message_id: 12345 })],
    ["a message_id with a slash", request({ type: "gmail_message", message_id: "abc/def" })],
    ["a message_id with a dot segment", request({ type: "gmail_message", message_id: ".." })],
    ["a message_id with a space", request({ type: "gmail_message", message_id: "abc def" })],
    ["a message_id with a query", request({ type: "gmail_message", message_id: "abc?format=full" })],
    ["a message_id ending in a newline", request({ type: "gmail_message", message_id: "abc\n" })],
    ["no max_bytes", JSON.stringify({ ref: gmailRef })],
    ["max_bytes of zero", request(gmailRef, 0)],
    ["a negative max_bytes", request(gmailRef, -5)],
    ["a fractional max_bytes", request(gmailRef, 10.5)],
    ["max_bytes as a string", request(gmailRef, "1000")],
  ])("400 bad_request for %s", async (_label, body) => {
    const res = await untouched(body);
    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe("bad_request");
    expect(res.headers["Content-Type"]).toBe("application/json");
  });

  it.each([
    ["a Drive file", { type: "drive_file", file_id: "abc" }],
    ["a missing type", { message_id: ID }],
    ["a near miss in case", { type: "Gmail_Message", message_id: ID }],
    ["a type that is not a string", { type: ["gmail_message"], message_id: ID }],
  ])("400 unsupported_ref for %s", async (_label, ref) => {
    const res = await untouched(request(ref));
    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe("unsupported_ref");
  });
});

describe("failures from Gmail", () => {
  const notFound = 'API error: {"error":{"code":404,"message":"Requested entity was not found.","reason":"notFound"}}';
  const forbidden = 'API error: {"error":{"code":403,"message":"Request had insufficient authentication scopes.","reason":"insufficientPermissions"}}';

  it("404 not_found when the metadata read says the message does not exist", async () => {
    const { res, calls } = await run([{ throws: notFound }]);
    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe("not_found");
    expect(rawCalls(calls)).toHaveLength(0);
  });

  it("404 not_found when the message disappears between the two reads", async () => {
    const { res } = await run([metadata(), { throws: notFound }]);
    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe("not_found");
  });

  it("502 upstream with Google's own message for any other failure", async () => {
    const { res } = await run([{ throws: forbidden }]);
    expect(res.status).toBe(502);
    expect(errorOf(res)).toEqual({
      code: "upstream",
      error: "Gmail could not return the message: Request had insufficient authentication scopes.",
    });
  });

  it("502 upstream when the raw read fails, and for a failure that is not an API error", async () => {
    const a = await run([metadata(), { throws: forbidden }]);
    expect(a.res.status).toBe(502);
    expect(errorOf(a.res).code).toBe("upstream");
    const b = await run([{ throws: "gmail users.messages get: the request timed out" }]);
    expect(b.res.status).toBe(502);
    expect(errorOf(b.res).error).toContain("timed out");
  });

  it("502 upstream when the answer carries no raw field, or an empty one", async () => {
    for (const text of [JSON.stringify({ id: ID }), JSON.stringify({ raw: "" })]) {
      const { res } = await run([metadata(), { text }]);
      expect(res.status).toBe(502);
      expect(errorOf(res).code).toBe("upstream");
    }
  });
});

describe("the file name", () => {
  it("removes control characters and the characters a file system refuses, and collapses whitespace", () => {
    expect(sanitiseSubject('  Re: a\\b/c:d*e?f"g<h>i|j  ')).toBe("Re abcdefghij");
    expect(sanitiseSubject("one\r\n\ttwo   three\u0000\u0007\u007f\u0085four")).toBe("one two threefour");
    expect(sanitiseSubject("café ☃ résumé")).toBe("café ☃ résumé");
  });

  it.each([undefined, "", "   ", '\\/:*?"<>|', "\u0000\u0001"])("falls back to `message` for %j", (subject) => {
    expect(sanitiseSubject(subject)).toBe("message");
  });

  it("a message with no Subject header is named `message`", async () => {
    const { res } = await run([metadata({ payload: { headers: [{ name: "Date", value: "x" }] } }), rawAnswer(Buffer.from("x"))]);
    expect(decodeURIComponent(res.headers["X-File-Name"])).toBe(`message 2026-03-09 ${ID}.eml`);
    const none = await run([metadata({ payload: undefined }), rawAnswer(Buffer.from("x"))]);
    expect(decodeURIComponent(none.res.headers["X-File-Name"])).toBe(`message 2026-03-09 ${ID}.eml`);
  });

  it("finds the Subject header whatever its case", async () => {
    const { res } = await run([metadata({ payload: { headers: [{ name: "SUBJECT", value: "Hi: there" }] } }), rawAnswer(Buffer.from("x"))]);
    expect(decodeURIComponent(res.headers["X-File-Name"])).toBe(`Hi there 2026-03-09 ${ID}.eml`);
  });

  it("the date is the UTC day of internalDate, and is left out when there is none", () => {
    expect(fileNameFor("S", INTERNAL_DATE, ID)).toBe(`S 2026-03-09 ${ID}.eml`);
    expect(fileNameFor("S", Number(INTERNAL_DATE), ID)).toBe(`S 2026-03-09 ${ID}.eml`);
    for (const absent of [undefined, null, "", "not a number", "9".repeat(30)]) {
      expect(fileNameFor("S", absent, ID)).toBe(`S ${ID}.eml`);
    }
  });

  it("a long subject is cut to 200 characters with the id and extension kept whole", () => {
    const name = fileNameFor("word ".repeat(100), INTERNAL_DATE, ID);
    expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(name.length).toBeGreaterThan(MAX_NAME_LENGTH - 6);
    expect(name.endsWith(` ${ID}.eml`)).toBe(true);
    expect(name.startsWith("word word")).toBe(true);
    expect(name).not.toMatch(/ {2}/);
  });

  it("a subject that fits exactly is not cut, and one character more is", () => {
    const tail = ` ${ID}.eml`;
    const fits = "s".repeat(MAX_NAME_LENGTH - tail.length);
    expect(fileNameFor(fits, undefined, ID)).toBe(fits + tail);
    const over = fileNameFor(fits + "X", undefined, ID);
    expect(over).toBe(fits + tail);
    expect(over.length).toBe(MAX_NAME_LENGTH);
  });

  it("a cut never leaves half of a surrogate pair, so the header can always be encoded", () => {
    for (let pad = 0; pad < 4; pad++) {
      const name = fileNameFor("a".repeat(pad) + "📧".repeat(150), undefined, ID);
      expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
      expect(name.endsWith(` ${ID}.eml`)).toBe(true);
      expect(name.isWellFormed()).toBe(true);
      expect(name).not.toContain("�");
      expect(() => encodeURIComponent(name)).not.toThrow();
    }
  });

  it("a subject holding a lone surrogate still yields a name that can be encoded", async () => {
    const { res } = await run([metadata({ payload: { headers: [{ name: "Subject", value: "bad \ud83d end" }] } }), rawAnswer(Buffer.from("x"))]);
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers["X-File-Name"]).endsWith(` ${ID}.eml`)).toBe(true);
  });

  it("an id so long it leaves no room keeps the id and extension and drops the rest", () => {
    const longId = "a".repeat(250);
    expect(fileNameFor("Subject", INTERNAL_DATE, longId)).toBe(`${longId}.eml`);
  });

  it("a non-ASCII name is percent-encoded in the header and decodes back", async () => {
    const { res } = await run([metadata({ payload: { headers: [{ name: "Subject", value: "Résumé ☃" }] } }), rawAnswer(Buffer.from("x"))]);
    expect(res.headers["X-File-Name"]).toMatch(/^[\x21-\x7e]+$/);
    expect(decodeURIComponent(res.headers["X-File-Name"])).toBe(`Résumé ☃ 2026-03-09 ${ID}.eml`);
  });
});

/**
 * The same route through the real client and Node's real fetch, with an
 * undici MockAgent answering as Gmail does. The fake above cannot show what
 * goes on the wire or what the transport's errors look like; this does.
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
      { method: "POST", token: TOKEN, body: request(gmailRef, maxBytes) },
      (accessToken) => new GwsClient({ accessToken })
    );

  it("asks for metadata with a repeated metadataHeaders key, then for the raw field alone, and returns the bytes", async () => {
    const eml = Buffer.alloc(300_000);
    for (let i = 0; i < eml.length; i++) eml[i] = (i * 31 + 7) % 256;
    const seen: Array<{ path: string; auth: string }> = [];
    const pool = agent.get(GMAIL);
    pool
      .intercept({ path: (p) => p.includes("format=metadata"), method: "GET" })
      .reply(200, (opts) => {
        seen.push({ path: opts.path, auth: String((opts.headers as Record<string, string>).authorization ?? (opts.headers as Record<string, string>).Authorization) });
        return {
          id: ID,
          sizeEstimate: eml.length,
          internalDate: INTERNAL_DATE,
          payload: { headers: [{ name: "Subject", value: "Wire: test" }] },
        };
      }, { headers: { "content-type": "application/json" } });
    pool
      .intercept({ path: (p) => p.includes("format=raw"), method: "GET" })
      .reply(200, (opts) => {
        seen.push({ path: opts.path, auth: "" });
        return JSON.stringify({ raw: eml.toString("base64url") }, null, 2);
      }, { headers: { "content-type": "application/json" } });

    const res = await call();
    expect(res.status).toBe(200);
    expect(res.body.equals(eml)).toBe(true);
    expect(decodeURIComponent(res.headers["X-File-Name"])).toBe(`Wire test 2026-03-09 ${ID}.eml`);

    expect(seen).toHaveLength(2);
    const first = new URL(GMAIL + seen[0].path);
    expect(first.pathname).toBe(`/gmail/v1/users/me/messages/${ID}`);
    expect(first.searchParams.getAll("metadataHeaders")).toEqual(["Subject", "Date"]);
    expect(seen[0].auth).toBe(`Bearer ${TOKEN}`);
    const second = new URL(GMAIL + seen[1].path);
    expect(second.searchParams.get("fields")).toBe("raw");
    expect(second.searchParams.get("alt")).toBeNull();
    // The token is in the Authorization header and nowhere in a URL.
    expect(seen.map((s) => s.path).join(" ")).not.toContain(TOKEN);
  });

  it("Gmail's 404 is not_found, and the answer never carries the token", async () => {
    agent
      .get(GMAIL)
      .intercept({ path: (p) => p.includes("format=metadata"), method: "GET" })
      .reply(404, { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } });
    const res = await call();
    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe("not_found");
    expect(res.body.toString("utf8")).not.toContain(TOKEN);
  });

  it("any other Gmail failure is upstream with Google's message, without the token", async () => {
    agent
      .get(GMAIL)
      .intercept({ path: (p) => p.includes("format=metadata"), method: "GET" })
      .reply(400, { error: { code: 400, message: "Invalid id value", status: "INVALID_ARGUMENT" } });
    const res = await call();
    expect(res.status).toBe(502);
    expect(errorOf(res)).toEqual({ code: "upstream", error: "Gmail could not return the message: Invalid id value" });
    expect(res.body.toString("utf8")).not.toContain(TOKEN);
  });

  it("an expired token is upstream, and no raw read follows", async () => {
    agent
      .get(GMAIL)
      .intercept({ path: (p) => p.includes("format=metadata"), method: "GET" })
      .reply(401, { error: { code: 401, message: "Invalid Credentials" } });
    const res = await call();
    expect(res.status).toBe(502);
    expect(errorOf(res).code).toBe("upstream");
    expect(res.body.toString("utf8")).not.toContain(TOKEN);
    agent.assertNoPendingInterceptors();
  });

  it("an over-cap estimate sends one request and no second", async () => {
    agent
      .get(GMAIL)
      .intercept({ path: (p) => p.includes("format=metadata"), method: "GET" })
      .reply(200, { id: ID, sizeEstimate: 9_000_000 }, { headers: { "content-type": "application/json" } });
    // No raw interceptor: with the network disabled, a raw read would fail
    // as upstream instead of answering 413.
    const res = await call(1_000_000);
    expect(res.status).toBe(413);
    expect(errorOf(res).code).toBe("too_large");
  });
});
