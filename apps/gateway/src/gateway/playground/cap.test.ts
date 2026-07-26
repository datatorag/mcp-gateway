import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const returning = vi.fn();
const update = vi.fn(() => ({ set: () => ({ where: () => ({ returning }) }) }));
const dbMock = { update } as unknown as Database;

import {
  capToolOutput, claimPlaygroundMessage, refundPlaygroundMessage, TOOL_OUTPUT_CAP,
} from "./cap";

describe("claimPlaygroundMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when the guarded UPDATE claims a row (under cap)", async () => {
    returning.mockResolvedValue([{ used: 5 }]);
    const claimed = await claimPlaygroundMessage(dbMock, "user-1", 20);
    expect(claimed).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("returns false when the guarded UPDATE claims no row (at cap)", async () => {
    returning.mockResolvedValue([]);
    const claimed = await claimPlaygroundMessage(dbMock, "user-1", 20);
    expect(claimed).toBe(false);
  });
});

describe("refundPlaygroundMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues the guarded decrement", async () => {
    returning.mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where: () => Promise.resolve(undefined) }));
    const updateFn = vi.fn(() => ({ set }));
    const db = { update: updateFn } as unknown as Database;
    await refundPlaygroundMessage(db, "user-1");
    expect(updateFn).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
  });
});

describe("capToolOutput", () => {
  it("leaves a result that fits exactly as it was", () => {
    // The common case by far, and the one where shape matters: a structured
    // result the model can read field by field must not become a string.
    const structured = { files: [{ id: "1", name: "notes" }], nextPageToken: null };
    expect(capToolOutput(structured)).toBe(structured);
    expect(capToolOutput("short")).toBe("short");
  });

  it("truncates an oversized string result to the cap", () => {
    const capped = capToolOutput("x".repeat(TOOL_OUTPUT_CAP * 2));
    expect(capped).toHaveLength(TOOL_OUTPUT_CAP);
  });

  it("collapses an oversized structured result to bounded text", () => {
    // Shape is worth less than a prompt that fits: an unbounded result is
    // re-sent on every later step of the turn, so one of these is paid for
    // repeatedly and can overflow the window outright.
    const capped = capToolOutput({ body: "y".repeat(TOOL_OUTPUT_CAP * 2) });
    expect(typeof capped).toBe("string");
    expect(capped).toHaveLength(TOOL_OUTPUT_CAP);
  });

  it("passes through a value it cannot serialize rather than dropping it", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(capToolOutput(circular)).toBe(circular);
    // `undefined` has no JSON form; it is still a legitimate tool result.
    expect(capToolOutput(undefined)).toBeUndefined();
  });
});
