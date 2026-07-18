import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const capture = vi.fn();
vi.mock("../lib/posthog-server.js", () => ({
  getPosthog: () => ({ capture, identify: vi.fn() }),
  shutdownPosthog: vi.fn(),
}));
vi.mock("../lib/slack.js", () => ({
  sendSlack: vi.fn().mockResolvedValue(undefined),
}));

import { trackToolCall } from "./track.js";
import { clearUserIdentityCache } from "./user-email.js";

const returning = vi.fn();
const insertValues = vi.fn();
const selectLimit = vi.fn();
const update = vi.fn(() => ({ set: () => ({ where: () => ({ returning }) }) }));
const dbMock = {
  update,
  insert: () => ({ values: insertValues }),
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;

function callProps(overrides: Partial<Parameters<typeof trackToolCall>[1]> = {}) {
  return {
    userId: "user-1",
    toolName: "gmail_search",
    connectorType: "google-workspace",
    accountEmail: "a@b.com",
    latencyMs: 100,
    responseSizeBytes: 10,
    errorMessage: null,
    outcome: { thrown: false, isError: false, errorMessage: null, source: "mcp" as const, toolName: "gmail_search" },
    ...overrides,
  };
}

describe("first_tool_call milestone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUserIdentityCache();
    insertValues.mockResolvedValue(undefined);
    returning.mockResolvedValue([]);
    selectLimit.mockResolvedValue([
      { email: "user-1@example.com", firstToolCallAt: null },
    ]);
  });

  it("fires first_tool_call when the milestone is newly claimed", async () => {
    returning.mockResolvedValue([{ id: "user-1" }]);
    await trackToolCall(dbMock, callProps());
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "first_tool_call",
        distinctId: "user-1",
        properties: expect.objectContaining({
          tool_name: "gmail_search",
          user_email: "user-1@example.com",
          $set: { email: "user-1@example.com" },
        }),
      })
    );
  });

  it("stamps user_email + $set identity on tool_call", async () => {
    await trackToolCall(dbMock, callProps());
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tool_call",
        properties: expect.objectContaining({
          user_email: "user-1@example.com",
          $set: { email: "user-1@example.com" },
        }),
      })
    );
  });

  it("does not fire first_tool_call when already claimed", async () => {
    returning.mockResolvedValue([]);
    await trackToolCall(dbMock, callProps());
    const events = capture.mock.calls.map((c) => c[0].event);
    expect(events).toContain("tool_call");
    expect(events).not.toContain("first_tool_call");
  });

  it("skips the claim UPDATE entirely once activation is cached", async () => {
    returning.mockResolvedValue([{ id: "user-1" }]);
    await trackToolCall(dbMock, callProps()); // claims + caches activation
    await trackToolCall(dbMock, callProps());
    await trackToolCall(dbMock, callProps());
    expect(update).toHaveBeenCalledTimes(1);
    const firstCalls = capture.mock.calls.filter(
      (c) => c[0].event === "first_tool_call"
    );
    expect(firstCalls).toHaveLength(1);
  });

  it("skips the claim UPDATE for users already activated in the db", async () => {
    selectLimit.mockResolvedValue([
      { email: "user-1@example.com", firstToolCallAt: new Date() },
    ]);
    await trackToolCall(dbMock, callProps());
    expect(update).not.toHaveBeenCalled();
  });

  it("ignores playground calls", async () => {
    await trackToolCall(
      dbMock,
      callProps({ outcome: { thrown: false, isError: false, errorMessage: null, source: "playground", toolName: "gmail_search" } })
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("ignores failed calls", async () => {
    await trackToolCall(
      dbMock,
      callProps({ outcome: { thrown: false, isError: true, errorMessage: "boom", source: "mcp", toolName: "gmail_search" } })
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("never breaks the tool-call path when the milestone update fails", async () => {
    returning.mockRejectedValue(new Error("db down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(trackToolCall(dbMock, callProps())).resolves.toBeUndefined();
    const events = capture.mock.calls.map((c) => c[0].event);
    expect(events).toContain("tool_call");
    expect(insertValues).toHaveBeenCalled(); // usage metering still ran
    warnSpy.mockRestore();
  });
});
