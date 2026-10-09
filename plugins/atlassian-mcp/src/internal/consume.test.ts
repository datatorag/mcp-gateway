import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AtlassianClient } from "../atlassian-client.js";
import { allTools } from "../tools/index.js";
import { handleJira, MAX_ATTACHMENT_BYTES } from "../tools/jira.js";
import { handleConsume, type ConsumeRequest } from "./consume.js";

/** jira_add_attachment, end to end through the private route, against a fake
 * fetch. No socket is opened and nothing leaves the process.
 *
 * The real AtlassianClient is used on purpose. The two properties of the
 * upload most likely to be broken by a tidy-up (no JSON content type, and
 * the X-Atlassian-Token header) live in the client, so a fake client would
 * assert them against itself. What is asserted here is the request fetch was
 * actually handed. */

const API = "https://api.atlassian.com";
const CLOUD = "cloud-1";
const JIRA = `${API}/ex/jira/${CLOUD}/rest/api/3`;
const TOKEN = "test-token-not-real";
const SUMMARY = "Quarterly invoice dispute";
const FILE_NAME = "Re: invoice 42.eml";
const BYTES = new TextEncoder().encode(
  "From: a@example.com\r\nSubject: Re: invoice 42\r\n\r\nbody é\r\n"
);

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

interface FakeJira {
  issue?: () => Response;
  meta?: () => Response;
  upload?: (call: Call) => Response | Promise<Response>;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Jira's answer to an upload: an array, one entry per file, echoing what
 * it stored. Size defaults to what was really sent. */
function stored(call: Call, overrides: Record<string, unknown> = {}) {
  const part = (call.body as FormData).get("file") as File;
  return json([
    {
      id: "10042",
      filename: part.name,
      size: part.size,
      mimeType: part.type,
      created: "2026-10-05T12:00:00.000+0000",
      ...overrides,
    },
  ]);
}

let calls: Call[];
let log: ReturnType<typeof vi.spyOn>;

function installFetch(fake: FakeJira = {}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: init?.body,
      };
      calls.push(call);
      if (call.url === `${API}/oauth/token/accessible-resources`) {
        return json([
          { id: CLOUD, name: "example", url: "https://example.atlassian.net/" },
        ]);
      }
      if (call.url === `${JIRA}/issue/PROJ-7?fields=summary,project`) {
        return (
          fake.issue?.() ??
          json({
            key: "PROJ-7",
            fields: {
              summary: SUMMARY,
              project: { key: "PROJ", name: "Project Seven" },
            },
          })
        );
      }
      if (call.url === `${JIRA}/attachment/meta`) {
        return fake.meta?.() ?? json({ enabled: true, uploadLimit: 10_000_000 });
      }
      if (call.url === `${JIRA}/issue/PROJ-7/attachments`) {
        return fake.upload ? fake.upload(call) : stored(call);
      }
      throw new Error(`unexpected request: ${call.method} ${call.url}`);
    })
  );
}

const DEFAULT_ARGS = {
  issue_key: "PROJ-7",
  file: { type: "gmail_message", message_id: "18c0ffee" },
};

function encodeArgs(args: unknown): string {
  return Buffer.from(JSON.stringify(args), "utf8").toString("base64url");
}

async function* chunksOf(...chunks: Uint8Array[]) {
  for (const c of chunks) yield c;
}

function request(
  over: {
    args?: unknown;
    headers?: Record<string, string | undefined>;
    method?: string;
    body?: AsyncIterable<Uint8Array>;
  } = {}
): ConsumeRequest {
  return {
    method: over.method ?? "POST",
    headers: {
      "x-user-token": TOKEN,
      "x-tool-name": "jira_add_attachment",
      "x-tool-args": encodeArgs(over.args ?? DEFAULT_ARGS),
      "x-file-name": encodeURIComponent(FILE_NAME),
      "x-file-type": "message/rfc822",
      "content-type": "application/octet-stream",
      ...over.headers,
    },
    body: over.body ?? chunksOf(BYTES),
  };
}

/** The tool result inside a 200, with its text parsed when it is JSON. */
function toolResult(res: Awaited<ReturnType<typeof handleConsume>>) {
  expect(res.status).toBe(200);
  const body = res.body as {
    content: Array<{ type: string; text: string }>;
    isError: boolean;
  };
  expect(body.content).toHaveLength(1);
  expect(body.content[0].type).toBe("text");
  return { isError: body.isError, text: body.content[0].text };
}

const uploads = () => calls.filter((c) => c.method === "POST");

beforeEach(() => {
  installFetch();
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The upload
// ---------------------------------------------------------------------------

describe("jira_add_attachment with bytes", () => {
  it("uploads one multipart part named file, with the exact bytes", async () => {
    const res = toolResult(await handleConsume(request()));
    expect(res.isError).toBe(false);

    expect(uploads()).toHaveLength(1);
    const [upload] = uploads();
    expect(upload.url).toBe(`${JIRA}/issue/PROJ-7/attachments`);
    expect(upload.method).toBe("POST");
    expect(upload.headers.get("x-atlassian-token")).toBe("no-check");
    expect(upload.headers.get("accept")).toBe("application/json");
    expect(upload.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    // fetch must be left to write the multipart content type itself: only it
    // knows the boundary. Any content type set here, JSON above all, breaks
    // the upload.
    expect(upload.headers.get("content-type")).toBeNull();

    expect(upload.body).toBeInstanceOf(FormData);
    const form = upload.body as FormData;
    expect([...form.keys()]).toEqual(["file"]);
    const part = form.get("file") as File;
    expect(part.name).toBe(FILE_NAME);
    expect(part.type).toBe("message/rfc822");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(BYTES);
  });

  it("answers a receipt naming the attachment, what was sent, the issue and the site", async () => {
    const res = toolResult(await handleConsume(request()));
    expect(JSON.parse(res.text)).toEqual({
      attachment: {
        id: "10042",
        filename: FILE_NAME,
        size: BYTES.byteLength,
        mime_type: "message/rfc822",
        created: "2026-10-05T12:00:00.000+0000",
      },
      sent: {
        bytes: BYTES.byteLength,
        sha256: createHash("sha256").update(BYTES).digest("hex"),
      },
      issue: {
        key: "PROJ-7",
        summary: SUMMARY,
        project: { key: "PROJ", name: "Project Seven" },
      },
      site: { name: "example", url: "https://example.atlassian.net" },
      source: { type: "gmail_message" },
    });
  });

  it("hashes the bytes it received, across chunk boundaries", async () => {
    const res = toolResult(
      await handleConsume(
        request({ body: chunksOf(BYTES.subarray(0, 5), BYTES.subarray(5)) })
      )
    );
    const receipt = JSON.parse(res.text);
    expect(receipt.sent.sha256).toBe(
      createHash("sha256").update(BYTES).digest("hex")
    );
    // A known-bad control: the hash is of these bytes, not of any bytes.
    expect(receipt.sent.sha256).not.toBe(
      createHash("sha256").update(BYTES.subarray(1)).digest("hex")
    );
    expect(receipt.sent.bytes).toBe(BYTES.byteLength);
  });

  it("reads the issue and the site's limits before it uploads", async () => {
    await handleConsume(request());
    const order = calls.map((c) => `${c.method} ${c.url.replace(JIRA, "")}`);
    const issueAt = order.indexOf("GET /issue/PROJ-7?fields=summary,project");
    const metaAt = order.indexOf("GET /attachment/meta");
    const uploadAt = order.indexOf("POST /issue/PROJ-7/attachments");
    expect(issueAt).toBeGreaterThanOrEqual(0);
    expect(metaAt).toBeGreaterThan(issueAt);
    expect(uploadAt).toBeGreaterThan(metaAt);
  });

  it.each([[404], [403]])(
    "sends nothing when the issue read answers %i",
    async (status) => {
      installFetch({
        issue: () => json({ errorMessages: ["Issue does not exist"] }, status),
      });
      const res = toolResult(await handleConsume(request()));
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/nothing was sent/i);
      expect(res.text).toContain(String(status));
      expect(uploads()).toHaveLength(0);
    }
  );

  it("refuses a file over the site's upload limit, stating the limit, with no upload", async () => {
    installFetch({
      meta: () => json({ enabled: true, uploadLimit: BYTES.byteLength - 1 }),
    });
    const res = toolResult(await handleConsume(request()));
    expect(res.isError).toBe(true);
    expect(res.text).toContain(`${BYTES.byteLength - 1} bytes`);
    expect(res.text).toMatch(/nothing was sent/i);
    expect(uploads()).toHaveLength(0);
  });

  it("accepts a file exactly at the site's upload limit", async () => {
    installFetch({
      meta: () => json({ enabled: true, uploadLimit: BYTES.byteLength }),
    });
    const res = toolResult(await handleConsume(request()));
    expect(res.isError).toBe(false);
    expect(uploads()).toHaveLength(1);
  });

  it("refuses when attachments are disabled on the site, with no upload", async () => {
    installFetch({ meta: () => json({ enabled: false, uploadLimit: 10_000_000 }) });
    const res = toolResult(await handleConsume(request()));
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not enabled/i);
    expect(res.text).toMatch(/nothing was sent/i);
    expect(uploads()).toHaveLength(0);
  });

  it.each([[".."], ["PROJ"], ["PROJ-7/../../x"], [""], [7], [undefined]])(
    "refuses issue key %j without a single request",
    async (issue_key) => {
      const res = toolResult(
        await handleConsume(request({ args: { ...DEFAULT_ARGS, issue_key } }))
      );
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/Not a Jira issue key/);
      expect(calls).toHaveLength(0);
    }
  );

  it("uses the filename argument over X-File-Name", async () => {
    const res = toolResult(
      await handleConsume(
        request({ args: { ...DEFAULT_ARGS, filename: "dispute.eml" } })
      )
    );
    const part = (uploads()[0].body as FormData).get("file") as File;
    expect(part.name).toBe("dispute.eml");
    expect(JSON.parse(res.text).attachment.filename).toBe("dispute.eml");
  });

  it("flags a size mismatch and still reports both sizes", async () => {
    installFetch({
      upload: (call) => stored(call, { size: BYTES.byteLength - 3 }),
    });
    const res = toolResult(await handleConsume(request()));
    expect(res.isError).toBe(false);
    const receipt = JSON.parse(res.text);
    expect(receipt.size_mismatch).toBe(true);
    expect(receipt.attachment.size).toBe(BYTES.byteLength - 3);
    expect(receipt.sent.bytes).toBe(BYTES.byteLength);
  });

  it("does not flag a mismatch when the sizes agree", async () => {
    const res = toolResult(await handleConsume(request()));
    expect(JSON.parse(res.text)).not.toHaveProperty("size_mismatch");
  });

  it("reports a refusal by Jira as a tool error, after one attempt", async () => {
    installFetch({
      upload: () => json({ errorMessages: ["No permission"] }, 403),
    });
    const res = toolResult(await handleConsume(request()));
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/refused/i);
    expect(res.text).toMatch(/not retried/i);
    expect(uploads()).toHaveLength(1);
  });

  it.each([
    ["a 503", () => json({}, 503)],
    [
      "a dropped connection",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("does not retry after %s, and says the outcome is unknown", async (_n, upload) => {
    installFetch({ upload });
    const res = toolResult(await handleConsume(request()));
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not known whether Jira stored the file/);
    expect(uploads()).toHaveLength(1);
  });

  it("logs the outcome, byte count and issue key, and nothing from the file or issue", async () => {
    await handleConsume(
      request({ args: { ...DEFAULT_ARGS, filename: "dispute.eml" } })
    );
    const lines = log.mock.calls.map((c: unknown[]) => c.join(" "));
    expect(lines).toEqual([
      `[consume] jira_add_attachment outcome=ok bytes=${BYTES.byteLength} issue=PROJ-7`,
    ]);
    const all = lines.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain("invoice");
    expect(all).not.toContain("dispute");
  });
});

// ---------------------------------------------------------------------------
// The ordinary MCP path
// ---------------------------------------------------------------------------

describe("jira_add_attachment through the MCP path", () => {
  it("is listed with its schema and annotations", () => {
    const tool = allTools.find((t) => t.name === "jira_add_attachment");
    expect(tool?.annotations).toEqual({
      title: "Add attachment to Jira issue",
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(tool?.inputSchema.required).toEqual(["issue_key", "file"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const file = (tool?.inputSchema.properties as any).file;
    expect(file.required).toEqual(["type", "message_id"]);
    expect(file.properties.type.enum).toEqual(["gmail_message", "gmail_attachment"]);
    expect(tool?.description).not.toContain(String.fromCharCode(0x2014));
  });

  /** The schema is the only thing a model reads before it calls. A gateway
   * can resolve a reference this schema does not name, and then the form
   * exists and nothing can discover it; a client that checks arguments
   * against the schema would refuse it outright. */
  it("advertises the attachment form: the type, the part id, and one file per call", () => {
    const tool = allTools.find((t) => t.name === "jira_add_attachment");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const file = (tool?.inputSchema.properties as any).file;
    expect(file.properties.part_id.type).toBe("string");
    expect(file.properties.part_id.description).toMatch(/gmail_read/);
    expect(file.properties.part_id.description).toMatch(/Required with gmail_attachment/);
    // Optional in the schema: a whole-message reference has no part.
    expect(file.required).not.toContain("part_id");
    // Never the attachment id: Gmail issues a new one on every read, so a
    // reference built from it stops naming anything.
    expect(Object.keys(file.properties).sort()).toEqual([
      "account",
      "message_id",
      "part_id",
      "type",
    ]);
    expect(file.description).toContain('"type": "gmail_message"');
    expect(file.description).toContain('"type": "gmail_attachment"');
    expect(file.description).toContain('"part_id"');
    expect(file.properties.type.description).not.toMatch(/only/i);

    const d = tool?.description ?? "";
    expect(d).toContain("A gmail_message reference attaches a whole email as its original .eml");
    expect(d).toContain("A gmail_attachment reference attaches one attachment of an email");
    expect(d).toContain("Several attachments are several calls, one file per call.");
    expect(d).not.toMatch(/only file reference/i);
    // What the description already promised stays promised.
    expect(d).toContain("its bytes never pass through the conversation");
    expect(d).toContain("The answer is a receipt");
    expect(d).toContain("The upload is never retried");
  });

  it("returns an error and asks Jira nothing when no bytes were supplied", async () => {
    const res = await handleJira(
      new AtlassianClient({ accessToken: TOKEN }),
      "jira_add_attachment",
      DEFAULT_ARGS
    );
    expect(res).toMatchObject({ isError: true });
    expect(res.content[0].text).toMatch(/file could not be supplied/i);
    expect(res.content[0].text).toMatch(/gateway/);
    expect(res.content[0].text).toMatch(/nothing was sent/i);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Route-level refusals
// ---------------------------------------------------------------------------

describe("POST /internal/consume refusals", () => {
  const refusal = async (req: ConsumeRequest) => {
    const res = await handleConsume(req);
    const body = res.body as { error: string; code: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
    // No refusal reaches Atlassian.
    expect(calls).toHaveLength(0);
    return { status: res.status, code: body.code };
  };

  it.each([["GET"], ["PUT"], ["DELETE"], [undefined]])(
    "answers 405 to %s",
    async (method) => {
      const req = request();
      req.method = method;
      expect((await refusal(req)).status).toBe(405);
    }
  );

  it.each([[undefined], [""]])("answers 401 no_token for token %j", async (t) => {
    expect(await refusal(request({ headers: { "x-user-token": t } }))).toEqual({
      status: 401,
      code: "no_token",
    });
  });

  it("answers 404 unknown_tool for a tool this route does not serve", async () => {
    // A real tool, but not one that takes bytes.
    expect(
      await refusal(request({ headers: { "x-tool-name": "jira_delete_issue" } }))
    ).toEqual({ status: 404, code: "unknown_tool" });
  });

  it.each([
    ["no tool name", { "x-tool-name": undefined }],
    ["no tool args", { "x-tool-args": undefined }],
    ["args that are not base64url", { "x-tool-args": "{not base64}" }],
    [
      "args that are not JSON",
      { "x-tool-args": Buffer.from("not json").toString("base64url") },
    ],
    ["args that are a JSON array", { "x-tool-args": encodeArgs(["PROJ-7"]) }],
    ["no file name", { "x-file-name": undefined }],
    ["a file name that is not URI-encoded", { "x-file-name": "%E0%A4%A" }],
    ["no file type", { "x-file-type": undefined }],
  ])("answers 400 bad_request for %s", async (_name, headers) => {
    expect(await refusal(request({ headers }))).toEqual({
      status: 400,
      code: "bad_request",
    });
  });

  it("answers 400 bad_request for an empty body", async () => {
    expect(await refusal(request({ body: chunksOf() }))).toEqual({
      status: 400,
      code: "bad_request",
    });
  });

  it("finds the headers whatever their case", async () => {
    const lower = request().headers;
    const upper = Object.fromEntries(
      Object.entries(lower).map(([k, v]) => [k.toUpperCase(), v])
    );
    const res = await handleConsume({ ...request(), headers: upper });
    expect(toolResult(res).isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The body cap
// ---------------------------------------------------------------------------

describe("POST /internal/consume body cap", () => {
  const MB = 1024 * 1024;

  it("is 25 MB", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(26214400);
  });

  it("answers 413 too_large and stops reading at the cap", async () => {
    let pulled = 0;
    let finished = false;
    const chunk = new Uint8Array(MB);
    // Far more than the cap, and with no Content-Length to give it away.
    async function* endless() {
      try {
        for (let i = 0; i < 200; i++) {
          pulled++;
          yield chunk;
        }
      } finally {
        finished = true;
      }
    }
    const res = await handleConsume(request({ body: endless() }));
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: "too_large" });
    // 25 chunks fit exactly; the 26th crosses the line and is the last pulled.
    expect(pulled).toBe(26);
    expect(finished).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("answers 413 on a declared length over the cap without reading the body", async () => {
    let pulled = 0;
    async function* body() {
      pulled++;
      yield BYTES;
    }
    const res = await handleConsume(
      request({
        headers: { "content-length": String(MAX_ATTACHMENT_BYTES + 1) },
        body: body(),
      })
    );
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: "too_large" });
    expect(pulled).toBe(0);
  });

  it("accepts a body of exactly the cap", async () => {
    installFetch({
      meta: () => json({ enabled: true, uploadLimit: MAX_ATTACHMENT_BYTES }),
    });
    const chunk = new Uint8Array(MB);
    const res = await handleConsume(
      request({ body: chunksOf(...Array.from({ length: 25 }, () => chunk)) })
    );
    const receipt = JSON.parse(toolResult(res).text);
    expect(receipt.sent.bytes).toBe(MAX_ATTACHMENT_BYTES);
  });
});
