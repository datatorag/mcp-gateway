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
    expect(healthBody({}, "a-salt")).toEqual({ status: "ok", analytics: "on", analytics_reason: "production", ip_salt: "set", plugins: {} });
    state.mockReturnValueOnce({ analytics: "off", analytics_reason: "outside production (NODE_ENV=development); set POSTHOG_ALLOW_NONPRODUCTION=1 to send" });
    const off = healthBody({}, "a-salt");
    expect(off.status).toBe("ok");
    expect(off.analytics).toBe("off");
    expect(off.analytics_reason).toContain("POSTHOG_ALLOW_NONPRODUCTION");
  });

  it("reports each plugin up or down and stays ok with one down (SCRUM-390)", () => {
    state.mockReturnValueOnce({ analytics: "on", analytics_reason: "production" });
    const body = healthBody({ "a-plugin": "up", "b-plugin": "down" }, "a-salt");
    expect(body.plugins).toEqual({ "a-plugin": "up", "b-plugin": "down" });
    expect(body.status).toBe("ok");
  });

  // SCRUM-76: without the salt every salted key is null, so a missing salt
  // is a field anyone can read, never the value.
  it.each([["", "missing"], ["   ", "missing"], ["a-salt", "set"]] as const)("ip_salt for %j is %s", (salt, want) => {
    state.mockReturnValueOnce({ analytics: "on", analytics_reason: "production" });
    const body = healthBody({}, salt);
    expect(body.ip_salt).toBe(want);
    expect(body.status).toBe("ok");
    expect(JSON.stringify(body)).not.toContain("a-salt");
  });
});
