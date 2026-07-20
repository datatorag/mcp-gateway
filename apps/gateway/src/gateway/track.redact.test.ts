import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";

// SEC-6: error_message must be redacted BEFORE it reaches PostHog (a third-party
// vendor), not only on the internal Postgres write path.

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

const insertValues = vi.fn();
const selectLimit = vi.fn();
const returning = vi.fn();
const dbMock = {
  update: () => ({ set: () => ({ where: () => ({ returning }) }) }),
  insert: () => ({ values: insertValues }),
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;

function props(errorMessage: string) {
  return {
    userId: "user-1",
    toolName: "gmail_search",
    connectorType: "google-workspace",
    accountEmail: "a@b.com",
    latencyMs: 100,
    responseSizeBytes: 10,
    errorMessage,
    outcome: {
      thrown: false,
      isError: true,
      errorMessage,
      source: "mcp" as const,
      toolName: "gmail_search",
    },
  };
}

function toolCallEvent() {
  return capture.mock.calls
    .map((c) => c[0])
    .find((e) => e.event === "tool_call");
}

describe("SEC-6: redact error_message before PostHog egress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUserIdentityCache();
    insertValues.mockResolvedValue(undefined);
    returning.mockResolvedValue([]);
    // Already-activated user so the milestone claim UPDATE is skipped.
    selectLimit.mockResolvedValue([
      { email: "user-1@example.com", firstToolCallAt: new Date() },
    ]);
  });

  it("scrubs an email out of error_message sent to capture()", async () => {
    await trackToolCall(dbMock, props("delivery to leaked@private.com failed"));
    const ev = toolCallEvent();
    expect(ev).toBeDefined();
    expect(ev.properties.error_message).toContain("[redacted-email]");
    expect(ev.properties.error_message).not.toContain("leaked@private.com");
  });

  it("scrubs a long opaque id out of error_message sent to capture()", async () => {
    await trackToolCall(
      dbMock,
      props("not found: 1A2b3C4d5E6f7G8h9I0jKLmnOpQrStUv")
    );
    const ev = toolCallEvent();
    expect(ev.properties.error_message).toContain("[redacted-id]");
    expect(ev.properties.error_message).not.toContain(
      "1A2b3C4d5E6f7G8h9I0jKLmnOpQrStUv"
    );
  });

  it("passes null through untouched", async () => {
    await trackToolCall(dbMock, {
      ...props("x"),
      errorMessage: null,
      outcome: {
        thrown: false,
        isError: false,
        errorMessage: null,
        source: "mcp" as const,
        toolName: "gmail_search",
      },
    });
    const ev = toolCallEvent();
    expect(ev.properties.error_message).toBeNull();
  });
});
