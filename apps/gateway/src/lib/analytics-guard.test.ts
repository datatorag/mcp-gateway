import { describe, expect, it } from "vitest";
import { posthogPolicy, POSTHOG_ALLOW_FLAG } from "./analytics-guard";

/* SCRUM-228: analytics is off outside production unless someone says
 * otherwise, and the answer carries its reason so /health can show it. */

describe("posthogPolicy", () => {
  it("is on in production with a key", () => {
    expect(posthogPolicy({ nodeEnv: "production", allow: "", hasKey: true })).toEqual({
      on: true,
      reason: "production",
    });
  });

  it("is off in production without a key, and says so", () => {
    const p = posthogPolicy({ nodeEnv: "production", allow: "", hasKey: false });
    expect(p.on).toBe(false);
    expect(p.reason).toContain("no key");
  });

  it("is off outside production by default, naming the environment and the flag", () => {
    for (const nodeEnv of ["development", "test", undefined, ""]) {
      const p = posthogPolicy({ nodeEnv, allow: "", hasKey: true });
      expect(p.on, String(nodeEnv)).toBe(false);
      expect(p.reason).toContain(POSTHOG_ALLOW_FLAG);
      expect(p.reason).toContain(nodeEnv ? nodeEnv : "unset");
    }
  });

  it("an unset NODE_ENV is treated as outside production, never as production", () => {
    expect(posthogPolicy({ nodeEnv: undefined, allow: "", hasKey: true }).on).toBe(false);
  });

  it("is on outside production only with the explicit flag set to exactly 1", () => {
    expect(posthogPolicy({ nodeEnv: "development", allow: "1", hasKey: true })).toEqual({
      on: true,
      reason: `development, allowed by ${POSTHOG_ALLOW_FLAG}=1`,
    });
    expect(posthogPolicy({ nodeEnv: "development", allow: "true", hasKey: true }).on).toBe(false);
    expect(posthogPolicy({ nodeEnv: "development", allow: "yes", hasKey: true }).on).toBe(false);
    expect(posthogPolicy({ nodeEnv: "development", allow: "1", hasKey: false }).on).toBe(false);
  });

  it("names the flag the way the env file spells it", () => {
    expect(POSTHOG_ALLOW_FLAG).toBe("POSTHOG_ALLOW_NONPRODUCTION");
  });
});
