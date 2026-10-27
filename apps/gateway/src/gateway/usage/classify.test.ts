import { describe, it, expect } from "vitest";
import { classifyOutcome, pluginFailureOf, PLUGIN_ERROR_META_KEY, type ClassifyInput, type PluginFailure } from "./classify";

describe("classifyOutcome", () => {
  it("classifies successful tool call as success + metered", () => {
    const r = classifyOutcome({
      thrown: false,
      isError: false,
      source: "mcp",
    });
    expect(r).toEqual({ status: "success", meter: true });
  });

  it("classifies MCP isError=true as user_error + metered", () => {
    const r = classifyOutcome({
      thrown: false,
      isError: true,
      errorMessage: "Invalid argument: message_id is required",
      source: "mcp",
    });
    expect(r).toEqual({ status: "user_error", meter: true });
  });

  it("classifies thrown exception with timeout as server_error + not metered", () => {
    const r = classifyOutcome({
      thrown: true,
      errorMessage: "Request timed out after 30s",
      source: "mcp",
    });
    expect(r).toEqual({ status: "server_error", meter: false });
  });

  it("classifies thrown exception with 5xx-like message as server_error + not metered", () => {
    const r = classifyOutcome({
      thrown: true,
      errorMessage: "500 Internal Server Error from upstream",
      source: "mcp",
    });
    expect(r).toEqual({ status: "server_error", meter: false });
  });

  it("classifies thrown exception with generic error as server_error + not metered", () => {
    const r = classifyOutcome({
      thrown: true,
      errorMessage: "ECONNREFUSED",
      source: "mcp",
    });
    expect(r).toEqual({ status: "server_error", meter: false });
  });

  it("meters the agent surface, the same as the gateway", () => {
    // REVERSED deliberately (SCRUM-57). This surface returned meter:false and
    // therefore wrote no usage row at all. The paid tier sells volume, so a
    // surface that does not meter is a volume path that does not count.
    expect(classifyOutcome({ thrown: false, source: "agent" }).meter).toBe(true);
    expect(
      classifyOutcome({ thrown: false, isError: true, source: "agent" }).meter
    ).toBe(true);
  });

  it("still never meters a call we broke ourselves, on either surface", () => {
    for (const source of ["mcp", "agent"] as const) {
      expect(classifyOutcome({ thrown: true, source }).meter).toBe(false);
    }
  });

  it("emits-but-never-meters gateway built-ins, on success AND user_error", () => {
    // SCRUM-66: built-ins get the tool_call event (their silence was
    // the defect) but must never reach a billing sink. Both non-thrown paths
    // pinned — a builtin user_error metering would be the same hole reopened
    // one branch over.
    expect(
      classifyOutcome({
        thrown: false,
        isError: false,
        source: "mcp",
        toolName: "echo",
        builtin: true,
      })
    ).toEqual({ status: "success", meter: false });
    expect(
      classifyOutcome({
        thrown: false,
        isError: true,
        source: "mcp",
        toolName: "list_connected_accounts",
        builtin: true,
      })
    ).toEqual({ status: "user_error", meter: false });
  });

  it("meters the one built-in that declares it, as a plugin call is metered (SCRUM-420)", () => {
    const call = { source: "mcp" as const, toolName: "file_download_link", builtin: true, meteredBuiltin: true };
    expect(classifyOutcome({ ...call, thrown: false, isError: false })).toEqual({ status: "success", meter: true });
    // A refusal is metered the way a plugin's refusal is.
    expect(classifyOutcome({ ...call, thrown: false, isError: true })).toEqual({ status: "user_error", meter: true });
    // A call we broke ourselves is never metered, built-in or not.
    expect(classifyOutcome({ ...call, thrown: true })).toEqual({ status: "server_error", meter: false });
    // The flag does nothing without the declaration being true.
    expect(classifyOutcome({ ...call, meteredBuiltin: false, thrown: false })).toEqual({ status: "success", meter: false });
  });

  it("does not meter oauth-refresh tool calls", () => {
    const r = classifyOutcome({
      thrown: false,
      isError: false,
      source: "mcp",
      toolName: "gws_auth_refresh",
    });
    expect(r.meter).toBe(false);
  });
});

/* SCRUM-154: a failure on our side or the provider's is a server_error and
 * never metered; a failure the request caused is a user_error and metered.
 * Decided from what the plugin states in the result's `_meta`, not its words. */
describe("classifyOutcome with the plugin's statement of the failure", () => {
  const failed = (failure: PluginFailure | null, extra: Partial<ClassifyInput> = {}) =>
    classifyOutcome({ thrown: false, isError: true, source: "mcp", toolName: "gws-mcp__gmail_read", failure, ...extra });
  const SERVER = { status: "server_error", meter: false };
  const USER = { status: "user_error", meter: true };

  it.each([500, 502, 503, 504])("an upstream %i is ours", (status) => {
    expect(failed({ kind: "http", status })).toEqual(SERVER);
  });

  it("an upstream 429 is ours", () => {
    expect(failed({ kind: "http", status: 429 })).toEqual(SERVER);
  });

  it("a transient failure is ours, with or without a status", () => {
    expect(failed({ kind: "transient", status: 503 })).toEqual(SERVER);
    expect(failed({ kind: "transient" })).toEqual(SERVER);
  });

  it("a request that never reached the provider is ours", () => {
    expect(failed({ kind: "unreachable" })).toEqual(SERVER);
  });

  it("a plugin crash is ours", () => {
    expect(failed({ kind: "crash" })).toEqual(SERVER);
  });

  it("a tool the plugin does not serve is ours", () => {
    expect(failed({ kind: "unknown_tool" })).toEqual(SERVER);
  });

  it("a scope refusal on a grant that holds every scope we request is ours", () => {
    expect(failed({ kind: "http", status: 403, reason: "insufficientPermissions" }, { grantComplete: true })).toEqual(SERVER);
    expect(failed({ kind: "http", status: 403, reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }, { grantComplete: true })).toEqual(SERVER);
  });

  it("a scope refusal on a grant the user narrowed is theirs", () => {
    expect(failed({ kind: "http", status: 403, reason: "insufficientPermissions" }, { grantComplete: false })).toEqual(USER);
    expect(failed({ kind: "http", status: 403, reason: "insufficientPermissions" })).toEqual(USER);
  });

  it("a 403 for any other reason is the request's own, on any grant", () => {
    expect(failed({ kind: "http", status: 403, reason: "forbidden" }, { grantComplete: true })).toEqual(USER);
  });

  it.each([400, 401, 404, 409, 422])("a provider %i is the request's own", (status) => {
    expect(failed({ kind: "http", status })).toEqual(USER);
  });

  it("a bad argument the plugin refused is the request's own", () => {
    expect(failed({ kind: "refused" })).toEqual(USER);
  });

  it("no statement keeps today's rule: a user_error, metered", () => {
    expect(failed(null)).toEqual(USER);
    expect(failed({ kind: "http" })).toEqual(USER);
  });

  it("a statement on a result that did not fail changes nothing", () => {
    expect(
      classifyOutcome({ thrown: false, isError: false, source: "mcp", failure: { kind: "crash" } })
    ).toEqual({ status: "success", meter: true });
  });

  it("an unmetered tool stays unmetered on a user error", () => {
    expect(failed({ kind: "refused" }, { builtin: true })).toEqual({ status: "user_error", meter: false });
  });
});

describe("pluginFailureOf", () => {
  const withMeta = (value: unknown) => ({ content: [], isError: true, _meta: { [PLUGIN_ERROR_META_KEY]: value } });

  it("reads the kind, status and reason the plugin wrote", () => {
    expect(pluginFailureOf(withMeta({ kind: "http", status: 403, reason: "insufficientPermissions" }))).toEqual({
      kind: "http",
      status: 403,
      reason: "insufficientPermissions",
    });
    expect(pluginFailureOf(withMeta({ kind: "unreachable" }))).toEqual({ kind: "unreachable" });
  });

  it("is null for a result with no statement, or one this gateway does not know", () => {
    expect(pluginFailureOf({ content: [], isError: true })).toBeNull();
    expect(pluginFailureOf(null)).toBeNull();
    expect(pluginFailureOf(withMeta({ kind: "something_new" }))).toBeNull();
    expect(pluginFailureOf(withMeta("crash"))).toBeNull();
  });

  it("drops a status or reason of the wrong type", () => {
    expect(pluginFailureOf(withMeta({ kind: "http", status: "503", reason: 7 }))).toEqual({ kind: "http" });
  });
});
