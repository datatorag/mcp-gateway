/**
 * Built-in outcomes through trackToolCall (SCRUM-66 / f-050): the event is
 * emitted with metered:false and the SAME property set as a plugin event,
 * and nothing billing reads is touched.
 *
 * "Anywhere billing reads" is exactly two sinks, both behind the single
 * `if (!meter) return` in track.ts: the usage_events insert (rollup →
 * usage_events_daily → the /api/usage/* dashboard routes and the digest) and
 * the period allowance counters on users (db.execute). So the billing claim
 * is proven here by asserting the db mock saw NO insert and NO execute — not
 * argued from the classify result alone.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const capture = vi.fn();
vi.mock("../lib/posthog-server", () => ({
  getPosthog: () => ({ capture, identify: vi.fn() }),
  shutdownPosthog: vi.fn(),
}));
vi.mock("../lib/slack", () => ({
  sendSlack: vi.fn().mockResolvedValue(undefined),
}));

import { trackToolCall } from "./track";
import { clearUserIdentityCache } from "./user-email";

const returning = vi.fn();
const insertValues = vi.fn();
const selectLimit = vi.fn();
const execute = vi.fn();
const update = vi.fn(() => ({ set: () => ({ where: () => ({ returning }) }) }));
const dbMock = {
  update,
  execute,
  insert: () => ({ values: insertValues }),
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;

function builtinProps() {
  return {
    userId: "user-1",
    toolName: "echo",
    connectorType: null,
    accountEmail: undefined,
    latencyMs: 5,
    responseSizeBytes: 42,
    errorMessage: null,
    outcome: {
      thrown: false,
      isError: false,
      errorMessage: null,
      source: "mcp" as const,
      toolName: "echo",
      builtin: true,
    },
  };
}

function pluginProps() {
  return {
    userId: "user-1",
    toolName: "gws-mcp__gmail_search",
    connectorType: "google-workspace",
    accountEmail: "a@b.com",
    latencyMs: 100,
    responseSizeBytes: 10,
    errorMessage: null,
    outcome: {
      thrown: false,
      isError: false,
      errorMessage: null,
      source: "mcp" as const,
      toolName: "gws-mcp__gmail_search",
    },
  };
}

function toolCallCaptures() {
  return capture.mock.calls
    .map((c) => c[0])
    .filter((c) => c.event === "tool_call");
}

describe("built-in tool_call tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUserIdentityCache();
    insertValues.mockResolvedValue(undefined);
    execute.mockResolvedValue([]);
    returning.mockResolvedValue([{ id: "user-1" }]);
    // An UNACTIVATED user, deliberately: the strongest state for the
    // no-billing and no-activation assertions, since every write guard is
    // live rather than short-circuited by a prior activation.
    selectLimit.mockResolvedValue([
      { email: "user-1@example.com", firstToolCallAt: null },
    ]);
  });

  it("emits tool_call with metered:false and touches NOTHING billing reads", async () => {
    await trackToolCall(dbMock, builtinProps());
    const events = toolCallCaptures();
    expect(events).toHaveLength(1);
    expect(events[0].properties.metered).toBe(false);
    expect(events[0].properties.tool_name).toBe("echo");
    expect(events[0].properties.status).toBe("success");
    // The two billing sinks: usage_events insert and the allowance counter.
    expect(insertValues).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("carries the IDENTICAL property set as a plugin event", async () => {
    // The acceptance criterion is "same property set", so assert the KEYS
    // are equal, not merely that a few chosen ones exist — a property that
    // quietly disappears from one side would slip past a contains-check.
    await trackToolCall(dbMock, builtinProps());
    await trackToolCall(dbMock, pluginProps());
    const [builtinEvent, pluginEvent] = toolCallCaptures();
    expect(Object.keys(builtinEvent.properties).sort()).toEqual(
      Object.keys(pluginEvent.properties).sort()
    );
    expect(builtinEvent.properties.metered).toBe(false);
    expect(pluginEvent.properties.metered).toBe(true);
  });

  it("does not claim first_tool_call activation for a built-in", async () => {
    await trackToolCall(dbMock, builtinProps());
    expect(update).not.toHaveBeenCalled();
    expect(
      capture.mock.calls.some((c) => c[0].event === "first_tool_call")
    ).toBe(false);
  });

  it("still claims activation and still meters for a plugin call — the other direction", async () => {
    // Without this, an over-broad builtin flag (or a guard that skips
    // activation for everyone) would pass every test above.
    await trackToolCall(dbMock, pluginProps());
    expect(
      capture.mock.calls.some((c) => c[0].event === "first_tool_call")
    ).toBe(true);
    expect(insertValues).toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
  });
});
