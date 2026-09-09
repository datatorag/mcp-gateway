import { describe, it, expect, vi } from "vitest";

/* SCRUM-228: /health carries the analytics state, computed by the same
 * function that gates the server client, so a production box that went
 * quiet (an unset NODE_ENV, a missing key) is a readable "off" with a
 * reason, never an absence somebody has to notice. */

const state = vi.fn();
vi.mock("@/lib/posthog-server", () => ({ posthogState: () => state() }));

const { healthBody } = await import("./health");

describe("healthBody", () => {
  it("keeps status ok and adds analytics on/off with the reason", () => {
    state.mockReturnValueOnce({ analytics: "on", analytics_reason: "production" });
    expect(healthBody()).toEqual({ status: "ok", analytics: "on", analytics_reason: "production" });
    state.mockReturnValueOnce({ analytics: "off", analytics_reason: "outside production (NODE_ENV=development); set POSTHOG_ALLOW_NONPRODUCTION=1 to send" });
    const off = healthBody();
    expect(off.status).toBe("ok");
    expect(off.analytics).toBe("off");
    expect(off.analytics_reason).toContain("POSTHOG_ALLOW_NONPRODUCTION");
  });
});
