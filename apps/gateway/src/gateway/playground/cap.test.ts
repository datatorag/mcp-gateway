import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const returning = vi.fn();
const update = vi.fn(() => ({ set: () => ({ where: () => ({ returning }) }) }));
const dbMock = { update } as unknown as Database;

import { claimPlaygroundMessage, refundPlaygroundMessage } from "./cap.js";

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
