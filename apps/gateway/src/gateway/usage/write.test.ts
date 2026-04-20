import { describe, it, expect, vi } from "vitest";
import { writeUsageEventWithTimeout } from "./write";

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
