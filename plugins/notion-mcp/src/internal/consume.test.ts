import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeFetch } from "../fixtures/fake-fetch.js";
import { recorded } from "../fixtures/load.js";
import { MAX_FILE_BYTES } from "../tools/notion-file.js";
import { handleConsume, type ConsumeRequest } from "./consume.js";

/** notion_attach_file through the private route (SCRUM-501), against a fake
 * fetch. No socket is opened and nothing leaves the process. The route
 * follows atlassian-mcp's; what is pinned here is that it serves this
 * plugin's one consuming tool, holds a body to its cap, and hands the tool a
 * client that never retries. */

const TOKEN = "fixture-bearer-not-a-real-token";
const PAGE = "122f53f3-d53e-4072-842d-9891b983e4e0";
const UPLOAD = "2e6a1b4c-5d7f-48a9-b0c1-d2e3f4a5b6c7";
const BOUNDARY = "----test-boundary";
const BYTES = new TextEncoder().encode("a small file\n");

type Part = { field: string; text: string } | { field: string; name: string; type: string; bytes: Uint8Array };

function multipart(parts: Part[]): Buffer {
  const enc = new TextEncoder();
  const out: Uint8Array[] = [];
  for (const part of parts) {
    if ("text" in part) {
      out.push(enc.encode(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.field}"\r\n\r\n${part.text}\r\n`));
    } else {
      out.push(
        enc.encode(
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.field}"; filename="${part.name}"\r\nContent-Type: ${part.type}\r\n\r\n`
        )
      );
      out.push(part.bytes);
      out.push(enc.encode("\r\n"));
    }
  }
  out.push(enc.encode(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(out);
}

const argsPart = (args: unknown): Part => ({ field: "args", text: JSON.stringify(args) });
const filePart = (field = "file"): Part => ({ field, name: "notes.txt", type: "text/plain", bytes: BYTES });

async function* chunksOf(...chunks: Uint8Array[]) {
  for (const c of chunks) yield c;
}

function request(over: { parts?: Part[]; headers?: Record<string, string | undefined>; method?: string } = {}): ConsumeRequest {
  const body = multipart(over.parts ?? [argsPart({ page_id: PAGE, file: { type: "content" } }), filePart()]);
  return {
    method: over.method ?? "POST",
    headers: {
      "x-user-token": TOKEN,
      "x-tool-name": "notion_attach_file",
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      ...over.headers,
    },
    body: chunksOf(body),
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /internal/consume", () => {
  it("attaches the handed file and answers the tool's receipt", async () => {
    const f = fakeFetch([
      { status: 200, body: recorded("page").body },
      { status: 200, body: recorded("users-me").body },
      { status: 200, body: { object: "file_upload", id: UPLOAD, status: "pending" } },
      { status: 200, body: { object: "file_upload", id: UPLOAD, status: "uploaded", content_length: BYTES.byteLength } },
      { status: 200, body: { object: "list", results: [{ object: "block", id: "b1", type: "file" }] } },
    ]);
    const res = await handleConsume(request());
    expect(res.status).toBe(200);
    const body = res.body as { content: Array<{ text: string }>; isError: boolean };
    expect(body.isError).toBe(false);
    expect(JSON.parse(body.content[0].text)).toMatchObject({ block: { id: "b1", type: "file" }, sent: { bytes: BYTES.byteLength } });
    expect(f.sent.every((r) => r.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("a write refused for rate is not sent again", async () => {
    const f = fakeFetch([
      { status: 200, body: recorded("page").body },
      { status: 200, body: recorded("users-me").body },
      { status: 429, body: { object: "error", status: 429, code: "rate_limited", message: "slow down" }, headers: { "Retry-After": "1" } },
    ]);
    const res = await handleConsume(request());
    const body = res.body as { content: Array<{ text: string }>; isError: boolean; _meta?: Record<string, unknown> };
    expect(body.isError).toBe(true);
    expect(body._meta).toBeDefined();
    expect(f.sent).toHaveLength(3);
  });

  it.each([
    [{ method: "GET" }, 405, "method_not_allowed"],
    [{ headers: { "x-user-token": undefined } }, 401, "no_token"],
    [{ headers: { "x-tool-name": undefined } }, 400, "bad_request"],
    [{ headers: { "x-tool-name": "notion_create_page" } }, 404, "unknown_tool"],
    [{ headers: { "content-type": "application/json" } }, 400, "bad_request"],
    [{ headers: { "content-length": String(MAX_FILE_BYTES * 2) } }, 413, "too_large"],
  ])("refuses %j with %i %s, and sends nothing", async (over, status, code) => {
    const f = fakeFetch([]);
    const res = await handleConsume(request(over));
    expect(res).toEqual({ status, body: { code, error: expect.any(String) } });
    expect(f.sent).toHaveLength(0);
  });

  it("two files are refused before anything is sent", async () => {
    const f = fakeFetch([]);
    const res = await handleConsume(
      request({ parts: [argsPart({ page_id: PAGE }), filePart("file"), filePart("attachments[0]")] })
    );
    const body = res.body as { content: Array<{ text: string }>; isError: boolean };
    expect(body.isError).toBe(true);
    expect(body.content[0].text).toMatch(/one file a call/);
    expect(f.sent).toHaveLength(0);
  });

  it("logs one line with no file name and no page title", async () => {
    fakeFetch([{ status: 404, body: recorded("err-not-found").body }]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleConsume(request());
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines).toEqual([`[consume] notion_attach_file outcome=error bytes=${BYTES.byteLength} page=${PAGE}`]);
  });
});
