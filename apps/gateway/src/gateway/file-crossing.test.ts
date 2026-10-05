/**
 * SCRUM-384 stage 1: a file crosses from one plugin to another inside one
 * tool call, held in the gateway's memory. Everything the crossing touches is
 * injected (fetch, the token resolver, the plugin address lookup), so these
 * tests assert the two requests exactly and never open a socket.
 */

import { describe, it, expect, vi } from "vitest";
import {
  crossFile,
  fileCrossingFor,
  transfersInFlight,
  FILE_CONSUMING_TOOLS,
  FILE_REFERENCE_TYPES,
  MAX_FILE_BYTES,
  MAX_TRANSFERS_HOST,
  MAX_TRANSFERS_PER_USER,
  TRANSFER_TIMEOUT_MS,
  type CrossFileOptions,
} from "./file-crossing";

const TOOL = "atlassian-mcp__jira_add_attachment";
const SOURCE_URL = "http://localhost:40001/mcp";
const DEST_URL = "http://localhost:40002/mcp";
const SOURCE_TOKEN = "source-token-fixture";
const DEST_TOKEN = "destination-token-fixture";
const FILE_BYTES = Buffer.from("From: a@example.com\r\nSubject: fixture\r\n\r\nbody é\r\n");
const FILE_NAME = "Re: café notes.eml";

const FULL_GRANT =
  "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify";
const IDENTITY_ONLY = "openid https://www.googleapis.com/auth/userinfo.email";

type Call = { url: string; init: RequestInit };
type Handler = (init: RequestInit) => Promise<Response> | Response;

function sourceOk(bytes: Buffer = FILE_BYTES): Handler {
  return () =>
    new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "message/rfc822",
        "X-File-Name": encodeURIComponent(FILE_NAME),
      },
    });
}

const RECEIPT = {
  content: [{ type: "text", text: "Attached to FIX-1 (fixture receipt)" }],
  isError: false,
};

function destOk(): Handler {
  return () => Response.json(RECEIPT);
}

function routeError(status: number, error: string, code: string): Handler {
  return () => Response.json({ error, code }, { status });
}

/** A request that never answers until its signal aborts, like a stuck plugin. */
function hang(): Handler {
  return (init) =>
    new Promise<Response>((_, reject) => {
      init.signal?.addEventListener("abort", () =>
        reject(new DOMException("This operation was aborted", "AbortError"))
      );
    });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function harness(over: {
  source?: Handler;
  dest?: Handler;
  args?: Record<string, unknown>;
  userId?: string;
  resolveToken?: CrossFileOptions["resolveToken"];
  resolvePluginUrl?: CrossFileOptions["resolvePluginUrl"];
  timeoutMs?: number;
  destinationToken?: string | null;
} = {}) {
  const calls: Call[] = [];
  const source = over.source ?? sourceOk();
  const dest = over.dest ?? destOk();
  const fetchFn = (async (url: string | URL, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    return call.url.endsWith("/internal/file-bytes") ? source(init) : dest(init);
  }) as unknown as typeof fetch;
  const resolveToken = vi.fn(
    over.resolveToken ??
      (async () => ({ token: SOURCE_TOKEN, accountEmail: "a@example.com", scopes: FULL_GRANT }))
  );
  const resolvePluginUrl = vi.fn(over.resolvePluginUrl ?? (async () => SOURCE_URL));
  const args = over.args ?? {
    issue_key: "FIX-1",
    file: { type: "gmail_message", message_id: "msg-fixture-1" },
  };
  const options: CrossFileOptions = {
    userId: over.userId ?? "user-1",
    tool: TOOL,
    toolName: "jira_add_attachment",
    args,
    destinationUrl: DEST_URL,
    destinationToken: over.destinationToken === undefined ? DEST_TOKEN : over.destinationToken,
    resolveToken,
    resolvePluginUrl,
    surface: "mcp",
    connectionsUrl: "https://gw.example.test/dashboard/connections",
    fetchFn,
    timeoutMs: over.timeoutMs,
  };
  return { calls, options, args, resolveToken, resolvePluginUrl, run: () => crossFile(options) };
}

function textOf(result: unknown): string {
  return ((result as { content?: Array<{ text?: string }> }).content ?? [])
    .map((c) => c.text)
    .join(" ");
}

function headersOf(call: Call): Headers {
  return new Headers(call.init.headers);
}

function everyHeaderValue(call: Call): string {
  return [...headersOf(call).entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
}

async function bodyBytes(call: Call): Promise<Buffer> {
  return Buffer.from(await new Response(call.init.body as BodyInit).arrayBuffer());
}

const idle = { host: 0, users: 0 };

describe("the registry", () => {
  it("is explicit: one consuming tool, one reference type, the stated limits", () => {
    expect(FILE_CONSUMING_TOOLS).toEqual({
      "atlassian-mcp__jira_add_attachment": { fileArg: "file" },
    });
    expect(FILE_REFERENCE_TYPES).toMatchObject({
      gmail_message: { plugin: "gws-mcp", service: "google-workspace" },
    });
    expect(MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_TRANSFERS_HOST).toBe(2);
    expect(MAX_TRANSFERS_PER_USER).toBe(1);
    expect(TRANSFER_TIMEOUT_MS).toBe(60_000);
  });

  it("names a consuming tool and nothing else", () => {
    expect(fileCrossingFor(TOOL)).toEqual({ fileArg: "file" });
    expect(fileCrossingFor("atlassian-mcp__jira_add_comment")).toBeNull();
    expect(fileCrossingFor("gws-mcp__gmail_search")).toBeNull();
    // A name that merely exists on Object.prototype is not a tool.
    expect(fileCrossingFor("constructor")).toBeNull();
    expect(fileCrossingFor("toString")).toBeNull();
  });
});

describe("the happy path", () => {
  it("asks the source for the bytes and hands exactly those to the destination", async () => {
    const h = harness();
    const result = await h.run();

    expect(h.calls).toHaveLength(2);
    const [first, second] = h.calls;

    expect(first.url).toBe("http://localhost:40001/internal/file-bytes");
    expect(first.init.method).toBe("POST");
    expect(Object.fromEntries(headersOf(first).entries())).toEqual({
      "content-type": "application/json",
      "x-user-token": SOURCE_TOKEN,
    });
    expect(JSON.parse(first.init.body as string)).toEqual({
      ref: { type: "gmail_message", message_id: "msg-fixture-1" },
      max_bytes: 26214400,
    });

    expect(second.url).toBe("http://localhost:40002/internal/consume");
    expect(second.init.method).toBe("POST");
    const h2 = Object.fromEntries(headersOf(second).entries());
    expect(Object.keys(h2).sort()).toEqual([
      "content-type",
      "x-file-name",
      "x-file-type",
      "x-tool-args",
      "x-tool-name",
      "x-user-token",
    ]);
    expect(h2["content-type"]).toBe("application/octet-stream");
    expect(h2["x-user-token"]).toBe(DEST_TOKEN);
    expect(h2["x-tool-name"]).toBe("jira_add_attachment");
    expect(h2["x-file-type"]).toBe("message/rfc822");
    expect(decodeURIComponent(h2["x-file-name"])).toBe(FILE_NAME);
    expect(JSON.parse(Buffer.from(h2["x-tool-args"], "base64url").toString("utf8"))).toEqual(h.args);
    expect((await bodyBytes(second)).equals(FILE_BYTES)).toBe(true);

    expect(result).toEqual(RECEIPT);
    expect(transfersInFlight()).toEqual(idle);
  });

  it("gives the source token only to the source and the destination token only to the destination", async () => {
    const h = harness();
    await h.run();
    const [first, second] = h.calls;
    expect(everyHeaderValue(first)).toContain(SOURCE_TOKEN);
    expect(everyHeaderValue(first)).not.toContain(DEST_TOKEN);
    expect(String(first.init.body)).not.toContain(DEST_TOKEN);
    expect(everyHeaderValue(second)).toContain(DEST_TOKEN);
    expect(everyHeaderValue(second)).not.toContain(SOURCE_TOKEN);
    expect(Buffer.from(headersOf(second).get("x-tool-args")!, "base64url").toString()).not.toContain(SOURCE_TOKEN);
  });

  it("resolves the source token for the reference's own account, and sends the plugin a closed reference", async () => {
    const h = harness({
      args: {
        issue_key: "FIX-1",
        file: { type: "gmail_message", message_id: "m1", account: "other@example.com", extra: "dropped", path: "/x" },
      },
    });
    await h.run();
    expect(h.resolveToken).toHaveBeenCalledTimes(1);
    expect(h.resolveToken).toHaveBeenCalledWith("google-workspace", "other@example.com");
    expect(h.resolvePluginUrl).toHaveBeenCalledWith("gws-mcp");
    // The account chose the token here; the plugin gets the type and the
    // fields that type declares, and nothing else the caller added.
    expect(JSON.parse(h.calls[0].init.body as string).ref).toEqual({ type: "gmail_message", message_id: "m1" });
  });

  it("returns a tool error the destination's tool reported, unchanged", async () => {
    const failed = { content: [{ type: "text", text: "Issue FIX-404 does not exist" }], isError: true };
    const h = harness({ dest: () => Response.json(failed) });
    expect(await h.run()).toEqual(failed);
  });
});

describe("refusals before any request", () => {
  const shapes: Array<[string, unknown, string]> = [
    ["missing", undefined, "file"],
    ["null", null, "file"],
    ["a string", "msg-1", "file"],
    ["an array", [{ type: "gmail_message", message_id: "m" }], "file"],
    ["no type", { message_id: "m" }, "type"],
    ["an unknown type", { type: "drive_file", file_id: "f" }, "drive_file"],
    ["a url type", { type: "url", url: "https://example.com/x" }, "gmail_message"],
    ["a prototype name as type", { type: "constructor", message_id: "m" }, "gmail_message"],
    ["no message_id", { type: "gmail_message" }, "message_id"],
    ["a numeric message_id", { type: "gmail_message", message_id: 7 }, "message_id"],
    ["an empty message_id", { type: "gmail_message", message_id: "" }, "message_id"],
    ["a non-string account", { type: "gmail_message", message_id: "m", account: 3 }, "account"],
  ];
  it.each(shapes)("refuses a file argument that is %s", async (_label, file, mentions) => {
    const args: Record<string, unknown> = { issue_key: "FIX-1" };
    if (file !== undefined) args.file = file;
    const h = harness({ args });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(mentions);
    expect(h.calls).toHaveLength(0);
    expect(h.resolveToken).not.toHaveBeenCalled();
    expect(transfersInFlight()).toEqual(idle);
  });

  it("refuses when the source service is not connected, naming what to connect", async () => {
    const h = harness({ resolveToken: async () => null });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("google-workspace is not connected");
    expect(textOf(result)).toContain("https://gw.example.test/dashboard/connections/google-workspace");
    expect(h.calls).toHaveLength(0);
  });

  it("refuses an account the user has not connected, naming it", async () => {
    const h = harness({
      resolveToken: async () => null,
      args: { file: { type: "gmail_message", message_id: "m", account: "nobody@example.com" } },
    });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No connected account found for nobody@example.com");
    expect(h.calls).toHaveLength(0);
  });

  it("refuses a source account whose grant lacks Gmail", async () => {
    const h = harness({
      resolveToken: async () => ({ token: SOURCE_TOKEN, accountEmail: "a@example.com", scopes: IDENTITY_ONLY }),
    });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Gmail access");
    expect(textOf(result)).not.toContain("googleapis.com");
    expect(h.calls).toHaveLength(0);
  });

  it("fails open on a grant it cannot read", async () => {
    const h = harness({
      resolveToken: async () => ({ token: SOURCE_TOKEN, accountEmail: null, scopes: null }),
    });
    expect(await h.run()).toEqual(RECEIPT);
  });

  it("refuses when the plugin that owns the reference is not installed", async () => {
    const h = harness({ resolvePluginUrl: async () => null });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(h.calls).toHaveLength(0);
  });

  it("refuses when there is no destination token", async () => {
    const h = harness({ destinationToken: null });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(h.calls).toHaveLength(0);
  });

  it("refuses arguments too large to travel in a header", async () => {
    const h = harness({
      args: { comment: "x".repeat(20_000), file: { type: "gmail_message", message_id: "m" } },
    });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(h.calls).toHaveLength(0);
    expect(transfersInFlight()).toEqual(idle);
  });

  it("refuses a second transfer for a user who has one in flight", async () => {
    const gate = deferred<Response>();
    const first = harness({ source: () => gate.promise });
    const firstRun = first.run();
    await vi.waitFor(() => expect(first.calls).toHaveLength(1));

    // The held transfer is let go whatever the assertions say, so a failure
    // here cannot leave a slot taken and fail the tests after it.
    try {
      const second = harness();
      const refused = await second.run();
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain("already");
      expect(second.calls).toHaveLength(0);
    } finally {
      gate.resolve(await sourceOk()({}));
    }
    expect(await firstRun).toEqual(RECEIPT);
    expect(transfersInFlight()).toEqual(idle);
    // And the slot is free again.
    expect(await harness().run()).toEqual(RECEIPT);
  });

  it("refuses a third transfer while two are in flight across the process", async () => {
    const gate = deferred<Response>();
    const a = harness({ userId: "user-a", source: () => gate.promise });
    const b = harness({ userId: "user-b", source: () => gate.promise });
    const runs = [a.run(), b.run()];
    await vi.waitFor(() => {
      expect(a.calls).toHaveLength(1);
      expect(b.calls).toHaveLength(1);
    });
    const c = harness({ userId: "user-c" });
    try {
      expect(transfersInFlight()).toEqual({ host: 2, users: 2 });
      const refused = await c.run();
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain("busy");
      expect(c.calls).toHaveLength(0);
    } finally {
      gate.resolve(await sourceOk()({}));
      // One Response body can be read once; the second reader fails, which
      // is fine here: both slots must come back either way.
      await Promise.allSettled(runs);
    }
    expect(transfersInFlight()).toEqual(idle);
    expect(await c.run()).toEqual(RECEIPT);
  });
});

describe("the source fails", () => {
  it.each([
    [413, "The message is 31 MB, over the 25 MB limit", "too_large"],
    [404, "No message with that id in this mailbox", "not_found"],
    [502, "Gmail did not answer", "upstream"],
    [401, "The Google token was rejected", "unauthorized"],
    [400, "Unknown reference type", "bad_ref"],
  ])("a %i becomes an error result carrying the plugin's message, and nothing is sent on", async (status, error, code) => {
    const h = harness({ source: routeError(status, error, code) });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(error);
    expect(h.calls).toHaveLength(1);
    expect(transfersInFlight()).toEqual(idle);
    expect(await harness().run()).toEqual(RECEIPT);
  });

  it("a failed answer is never sent on, even one dressed as a file", async () => {
    // Status decides, not the look of the answer: a failure that carries a
    // name, a type and a body must still stop here.
    const h = harness({
      source: () =>
        new Response(new Uint8Array(FILE_BYTES), {
          status: 502,
          headers: { "Content-Type": "message/rfc822", "X-File-Name": "partial.eml" },
        }),
    });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(h.calls).toHaveLength(1);
  });

  it("an error body that is not JSON still refuses, without a destination request", async () => {
    const h = harness({ source: () => new Response("<html>bad gateway</html>", { status: 502 }) });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(h.calls).toHaveLength(1);
  });

  it("cuts off a body that runs past the cap and never buffers more than the cap", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const TOTAL_CHUNKS = 40;
    let pulls = 0;
    let cancelled = false;
    const h = harness({
      source: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1;
              if (pulls > TOTAL_CHUNKS) controller.close();
              else controller.enqueue(chunk);
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200, headers: { "Content-Type": "message/rfc822", "X-File-Name": "big.eml" } }
        ),
    });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("25 MB");
    expect(h.calls).toHaveLength(1);
    expect(cancelled).toBe(true);
    // 25 chunks fit, the 26th crosses the line; a little read-ahead is the
    // stream's own queue, not ours.
    expect(pulls).toBeLessThanOrEqual(28);
    expect(pulls).toBeLessThan(TOTAL_CHUNKS);
    expect(h.calls[0].init.signal?.aborted).toBe(true);
    expect(transfersInFlight()).toEqual(idle);
  });

  it("refuses on a declared length over the cap without reading the body", async () => {
    let pulls = 0;
    const h = harness({
      source: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1;
              controller.enqueue(new Uint8Array(1024));
            },
          }, { highWaterMark: 0 }),
          {
            status: 200,
            headers: {
              "Content-Type": "message/rfc822",
              "X-File-Name": "big.eml",
              "Content-Length": String(MAX_FILE_BYTES + 1),
            },
          }
        ),
    });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("25 MB");
    expect(pulls).toBe(0);
    expect(h.calls).toHaveLength(1);
  });

  it("accepts a file of exactly the cap", async () => {
    const exact = Buffer.alloc(MAX_FILE_BYTES, 1);
    const h = harness({ source: sourceOk(exact) });
    expect(await h.run()).toEqual(RECEIPT);
    expect((await bodyBytes(h.calls[1])).length).toBe(MAX_FILE_BYTES);
  });

  it("refuses a source answer with no usable file name", async () => {
    const noName = harness({ source: () => new Response("x", { status: 200 }) });
    expect((await noName.run()).isError).toBe(true);
    expect(noName.calls).toHaveLength(1);
    const badName = harness({
      source: () => new Response("x", { status: 200, headers: { "X-File-Name": "%E0%A4%A" } }),
    });
    expect((await badName.run()).isError).toBe(true);
    expect(badName.calls).toHaveLength(1);
  });

  it("a source that cannot be reached throws, uploads nothing and frees the slot", async () => {
    const h = harness({
      source: () => {
        throw new TypeError(`fetch failed with ${SOURCE_TOKEN}`);
      },
    });
    const error = await h.run().then(
      () => null,
      (e: Error) => e
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain("Nothing was uploaded");
    expect(error!.message).not.toContain(SOURCE_TOKEN);
    expect(h.calls).toHaveLength(1);
    expect(transfersInFlight()).toEqual(idle);
    expect(await harness().run()).toEqual(RECEIPT);
  });
});

describe("the destination fails", () => {
  it.each([
    [400, "issue_key is required", "bad_args"],
    [401, "The Atlassian token was rejected", "unauthorized"],
    [404, "No tool named jira_add_attachment takes a file", "unknown_tool"],
    [413, "The file is over the limit", "too_large"],
  ])("a route-level %i becomes an error result with the message", async (status, error, code) => {
    const h = harness({ dest: routeError(status, error, code) });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(error);
    expect(h.calls).toHaveLength(2);
    expect(transfersInFlight()).toEqual(idle);
    expect(await harness().run()).toEqual(RECEIPT);
  });

  it("a 200 that is not a tool result is an error that admits the upload may have happened", async () => {
    const h = harness({ dest: () => Response.json({ ok: true }) });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("may or may not");
  });

  it("a destination that drops the connection throws, admits the doubt and frees the slot", async () => {
    const h = harness({
      dest: () => {
        throw new TypeError(`socket hang up ${DEST_TOKEN}`);
      },
    });
    const error = await h.run().then(
      () => null,
      (e: Error) => e
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain("may or may not");
    expect(error!.message).not.toContain(DEST_TOKEN);
    expect(transfersInFlight()).toEqual(idle);
    expect(await harness().run()).toEqual(RECEIPT);
  });
});

describe("the deadline", () => {
  it("on the first leg: abandoned, nothing uploaded, no destination request", async () => {
    const h = harness({ source: hang(), timeoutMs: 30 });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("abandoned");
    expect(textOf(result)).toContain("Nothing was uploaded");
    expect(textOf(result)).not.toContain("may or may not");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].init.signal?.aborted).toBe(true);
    expect(transfersInFlight()).toEqual(idle);
    expect(await harness().run()).toEqual(RECEIPT);
  });

  it("on the second leg: abandoned, and the file may or may not have been uploaded", async () => {
    const h = harness({ dest: hang(), timeoutMs: 30 });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("abandoned");
    expect(textOf(result)).toContain("may or may not");
    expect(textOf(result)).not.toContain("Nothing was uploaded");
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].init.signal?.aborted).toBe(true);
    expect(transfersInFlight()).toEqual(idle);
    expect(await harness().run()).toEqual(RECEIPT);
  });

  it("covers both legs with one clock, not one each", async () => {
    // Leg one takes most of the budget; leg two would fit a fresh budget but
    // not what is left of the shared one.
    const slow = (ms: number, then: Handler): Handler => (init) =>
      new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(then(init)), ms);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("This operation was aborted", "AbortError"));
        });
      });
    const h = harness({ source: slow(60, sourceOk()), dest: slow(60, destOk()), timeoutMs: 90 });
    const result = await h.run();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("may or may not");
  });

  it("uses one signal for both requests", async () => {
    const h = harness();
    await h.run();
    expect(h.calls[0].init.signal).toBeDefined();
    expect(h.calls[0].init.signal).toBe(h.calls[1].init.signal);
  });
});
