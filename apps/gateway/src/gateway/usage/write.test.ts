import { describe, it, expect, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import {
  writeUsageEvent,
  writeUsageEventWithTimeout,
  MAX_STORED_ERROR_LEN,
} from "./write";

function baseInput(errorMessage: string | null) {
  return {
    userId: "user-1",
    toolName: "gmail_search",
    connector: "google-workspace",
    accountEmail: "a@example.com",
    status: "user_error" as const,
    latencyMs: 10,
    responseSizeBytes: null,
    errorMessage,
  };
}

/* SCRUM-200: the row is the user's own data, shown back only to them, and
 * they already got the full error live. It is stored raw so it can be
 * diagnosed. The redactor used to be the only length cap on this path, so an
 * explicit one replaces it: an unbounded text column plus a provider that
 * echoes a large input back would otherwise write that input, whole, per row. */
describe("writeUsageEvent stores error_message raw, with an explicit cap", () => {
  const values = vi.fn().mockResolvedValue(undefined);
  const db = { insert: () => ({ values }) } as unknown as Database;

  it("stores an email and a long quoted run of content intact", async () => {
    values.mockClear();
    const raw =
      'delivery to leaked@example.com failed: subject was "The quick brown fox jumps over the lazy dog today and tomorrow"';
    const result = await writeUsageEvent(db, baseInput(raw));
    expect(result).toEqual({ ok: true });
    expect(values.mock.calls[0][0].errorMessage).toBe(raw);
  });

  it("passes null through as null", async () => {
    values.mockClear();
    await writeUsageEvent(db, baseInput(null));
    expect(values.mock.calls[0][0].errorMessage).toBeNull();
  });

  it("caps a deliberately oversized message at MAX_STORED_ERROR_LEN and marks the cut", async () => {
    values.mockClear();
    const oversized = "x".repeat(MAX_STORED_ERROR_LEN * 10);
    await writeUsageEvent(db, baseInput(oversized));
    const stored: string = values.mock.calls[0][0].errorMessage;
    expect(stored.length).toBe(MAX_STORED_ERROR_LEN);
    expect(stored.endsWith("[truncated]")).toBe(true);
  });

  it("leaves a message exactly at the cap alone", async () => {
    values.mockClear();
    const atCap = "y".repeat(MAX_STORED_ERROR_LEN);
    await writeUsageEvent(db, baseInput(atCap));
    expect(values.mock.calls[0][0].errorMessage).toBe(atCap);
  });
});

describe("writeUsageEventWithTimeout", () => {
  it("resolves ok when insert completes within timeout", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const result = await writeUsageEventWithTimeout(insert, 200);
    expect(result).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("resolves timeout when insert exceeds the budget", async () => {
    const insert = () => new Promise<void>((res) => setTimeout(res, 500));
    const result = await writeUsageEventWithTimeout(insert, 50);
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("resolves error when insert throws", async () => {
    const insert = () => Promise.reject(new Error("boom"));
    const result = await writeUsageEventWithTimeout(insert, 200);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
    }
  });
});
