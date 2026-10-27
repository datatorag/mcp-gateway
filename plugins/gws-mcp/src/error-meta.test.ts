import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./create-server.js";
import { GwsClient } from "./gws-client.js";
import { ERROR_META_KEY, errorMetaFor } from "./error-meta.js";
import { retryClock } from "./google-api/rate-limit-retry.js";

/* What a failed call says about whose failure it was (SCRUM-154), through the
 * MCP server the way the gateway calls it. The gateway meters on this field,
 * so each kind is pinned from the answer that produces it. */

const TOKEN = "fixture-bearer-not-a-real-token";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function call(name: string, args: Record<string, unknown> = {}) {
  const server = createMcpServer(new GwsClient({ accessToken: TOKEN }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return (await mcp.callTool({ name, arguments: args })) as {
    isError?: boolean;
    _meta?: Record<string, unknown>;
  };
}

/** Every request gets a fresh answer: a read refused for rate is retried. */
function answer(respond: () => Response) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => respond());
}

beforeEach(() => {
  vi.spyOn(retryClock, "sleep").mockResolvedValue();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a failed call names its kind in _meta", () => {
  it("Google's 404 is an http error with its status and reason", async () => {
    answer(() => json({ error: { code: 404, message: "gone", status: "NOT_FOUND" } }, 404));
    const res = await call("gmail_list_labels");
    expect(res.isError).toBe(true);
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "http", status: 404, reason: "NOT_FOUND" });
  });

  it("an insufficient-scope 403 carries Google's reason", async () => {
    answer(() =>
      json(
        { error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } },
        403
      )
    );
    const res = await call("gmail_list_labels");
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "http", status: 403, reason: "insufficientPermissions" });
  });

  it("a 400 whose message quotes a gateway status is still the request's own", async () => {
    answer(() => json({ error: { code: 400, message: "Invalid value '503 Service Unavailable' for field" } }, 400));
    const res = await call("gmail_list_labels");
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "http", status: 400 });
  });

  it("Google's rate refusal on a 403 is transient", async () => {
    answer(() => json({ error: { code: 403, message: "Rate Limit Exceeded", errors: [{ reason: "userRateLimitExceeded" }] } }, 403));
    const res = await call("gmail_list_labels");
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "transient", status: 403 });
  });

  it("a 401 is an http error, the caller's to reconnect", async () => {
    answer(() => json({ error: { code: 401, message: "Invalid Credentials" } }, 401));
    const res = await call("gmail_list_labels");
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "http", status: 401 });
  });

  it("a 503 is transient, with its status", async () => {
    answer(() => new Response("<html>upstream</html>", { status: 503 }));
    const res = await call("gmail_list_labels");
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "transient", status: 503 });
  });

  it("a 429 keeps its status", async () => {
    answer(() => json({ error: { code: 429, message: "Too many requests" } }, 429));
    const res = await call("gmail_list_labels");
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "http", status: 429 });
  });

  it("a connection reset is transient, with no status", async () => {
    answer(() => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    });
    const res = await call("gmail_list_labels");
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "transient" });
  });

  it("a network failure not known to pass on a retry is unreachable", async () => {
    answer(() => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    });
    const res = await call("gmail_list_labels");
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "unreachable" });
  });

  it("an argument the tool does not take is refused before any request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await call("gmail_read", {});
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "refused" });
  });

  it("a tool this plugin does not serve is unknown_tool", async () => {
    const res = await call("not_a_tool");
    expect(res.isError).toBe(true);
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "unknown_tool" });
  });

  it("a success carries no error field", async () => {
    answer(() => json({ labels: [] }));
    const res = await call("gmail_list_labels");
    expect(res.isError).toBeFalsy();
    expect(res._meta?.[ERROR_META_KEY]).toBeUndefined();
  });
});

describe("errorMetaFor", () => {
  it("a runtime error is a crash, and so is a thrown non-Error", () => {
    expect(errorMetaFor(new ReferenceError("x is not defined"))).toEqual({ kind: "crash" });
    expect(errorMetaFor(new TypeError("cannot read properties of undefined"))).toEqual({ kind: "crash" });
    expect(errorMetaFor("a string")).toEqual({ kind: "crash" });
  });

  it("a timeout is unreachable", () => {
    expect(errorMetaFor(Object.assign(new Error("timed out"), { name: "TimeoutError" }))).toEqual({ kind: "unreachable" });
  });

  it("a plain Error is the plugin's own refusal", () => {
    expect(errorMetaFor(new Error("Validation error: missing required path parameter"))).toEqual({ kind: "refused" });
  });
});
