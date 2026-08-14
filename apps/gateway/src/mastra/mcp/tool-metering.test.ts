import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tool } from "@mastra/core/tools";

const trackToolCall = vi.fn();
vi.mock("@/gateway/track", () => ({ trackToolCall }));

const { applyToolPolicy } = await import("./client");

/**
 * What a usage row for an agent tool call actually contains.
 *
 * This is the file that would have caught the defect it exists because of.
 * Agent metering used to run off the UI message stream, where a chunk carries
 * a tool name and nothing else, so every row reached `usage_events` with a
 * null connector and a zero latency, in a table with no surface column that
 * feeds the customer-facing by-connector and latency views. The old tests
 * asserted the event was emitted and the name was right, which was true, and
 * said nothing about the fields that were wrong.
 *
 * So these assert the FIELDS, not the fact of emission.
 */

const DB = { tag: "db" } as never;
const METER = {
  db: DB,
  userId: "user-1",
  runId: "run-abc",
  connectorType: "google-workspace",
  // The account the plugin session was actually opened as. This, not any
  // account argument the model types, is what rows must stamp (SCRUM-78):
  // the argument is stripped before the call, so it names a mailbox the call
  // never touches.
  resolvedAccountEmail: "default@example.com",
};

/** A tool whose execute returns whatever it is told to, and records the input
 * it actually received, so the account-strip can be asserted from the tool's
 * side rather than from ours. */
function toolReturning(result: unknown | (() => unknown)) {
  const seen: unknown[] = [];
  const tool = {
    execute: async (input: unknown) => {
      seen.push(input);
      return typeof result === "function" ? (result as () => unknown)() : result;
    },
  } as unknown as Tool<unknown, unknown, unknown, unknown>;
  return { tool, seen };
}

describe("agent tool metering", () => {
  beforeEach(() => trackToolCall.mockClear());

  it("reports the connector, the account and a real latency", async () => {
    const { tool } = toolReturning({ content: [{ type: "text", text: "ok" }] });
    const wrapped = applyToolPolicy("gws-mcp__docs_get", tool, METER);

    await wrapped.execute!({ account: "me@example.com", docId: "d1" } as never, {} as never);

    expect(trackToolCall).toHaveBeenCalledTimes(1);
    const [db, props] = trackToolCall.mock.calls[0];
    expect(db).toBe(DB);
    expect(props).toMatchObject({
      userId: "user-1",
      toolName: "gws-mcp__docs_get",
      // The three fields the stream tap could not see. Null/0 here is the bug.
      connectorType: "google-workspace",
      // The RESOLVED account, not the argument: the arg is stripped before
      // the call, so the session's own account is the only truthful stamp.
      accountEmail: "default@example.com",
      runId: "run-abc",
      outcome: { source: "agent", thrown: false, isError: false },
    });
    expect(props.latencyMs).toBeTypeOf("number");
    expect(props.responseSizeBytes).toBeGreaterThan(0);
  });

  it("strips the account arg, and stamps the account the call actually ran as", async () => {
    // Both halves matter: the arg is ours, not the plugin's, so it must not
    // reach the plugin; and since the strip means every call runs as the
    // session's own account, stamping the ARGUMENT would record a mailbox
    // the call never touched. The row carries the resolved account even when
    // the model asked for another.
    const { tool, seen } = toolReturning({ ok: true });
    const wrapped = applyToolPolicy("gws-mcp__gmail_read", tool, METER);

    await wrapped.execute!({ account: "work@example.com", id: "m1" } as never, {} as never);

    expect(seen[0]).toEqual({ id: "m1" });
    expect(trackToolCall.mock.calls[0][1].accountEmail).toBe("default@example.com");
  });

  it("falls back to the argument only when resolution reported no account", async () => {
    // A meter with no resolved account (legacy connections, injected test
    // doubles) keeps the old argument-derived stamp rather than losing the
    // only attribution it has.
    const { tool } = toolReturning({ ok: true });
    const wrapped = applyToolPolicy("gws-mcp__gmail_read", tool, {
      ...METER,
      resolvedAccountEmail: null,
    });

    await wrapped.execute!({ account: "work@example.com", id: "m1" } as never, {} as never);

    expect(trackToolCall.mock.calls[0][1].accountEmail).toBe("work@example.com");
  });

  it("separates a tool that failed from one that worked", async () => {
    const { tool } = toolReturning({
      isError: true,
      content: [{ type: "text", text: "permission denied" }],
    });
    const wrapped = applyToolPolicy("gws-mcp__docs_get", tool, METER);

    await wrapped.execute!({} as never, {} as never);

    const props = trackToolCall.mock.calls[0][1];
    // The call reached the plugin; failing there does not un-spend it.
    expect(props.outcome).toMatchObject({ source: "agent", thrown: false, isError: true });
    expect(props.errorMessage).toBe("permission denied");
  });

  it("reports a thrown call as thrown, and still rethrows", async () => {
    const { tool } = toolReturning(() => {
      throw new Error("connection refused");
    });
    const wrapped = applyToolPolicy("gws-mcp__docs_get", tool, METER);

    await expect(wrapped.execute!({} as never, {} as never)).rejects.toThrow("connection refused");

    const props = trackToolCall.mock.calls[0][1];
    expect(props.outcome).toMatchObject({ source: "agent", thrown: true });
    expect(props.errorMessage).toBe("connection refused");
    // No size for a call that produced nothing, matching the gateway path.
    expect(props.responseSizeBytes).toBeNull();
  });

  it("does not meter when no meter context is supplied", async () => {
    // The injectable tests build tool sets with no database. Metering must be
    // off by absence rather than by every caller passing a stub.
    const { tool } = toolReturning({ ok: true });
    const wrapped = applyToolPolicy("gws-mcp__docs_get", tool);

    await wrapped.execute!({} as never, {} as never);

    expect(trackToolCall).not.toHaveBeenCalled();
  });

  it("survives a result it cannot serialize", async () => {
    // Sizing must never turn a successful tool call into a failed one. A
    // circular result is unusual, but losing a user's answer to a metering
    // detail would be the wrong trade every time.
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    const { tool } = toolReturning(circular);
    const wrapped = applyToolPolicy("gws-mcp__docs_get", tool, METER);

    await expect(wrapped.execute!({} as never, {} as never)).resolves.toBeDefined();
    expect(trackToolCall.mock.calls[0][1].responseSizeBytes).toBeNull();
  });
});
