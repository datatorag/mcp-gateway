import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* SCRUM-228: the server client initialises only when the policy says on,
 * and says once, in the log, why it did not. Never a hard exit. */

const env: Record<string, string> = {};
vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => env }));
const ctor = vi.fn();
vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor(...args: unknown[]) {
      ctor(...args);
    }
    async shutdown() {}
  },
}));

async function fresh() {
  vi.resetModules();
  return import("./posthog-server");
}

beforeEach(() => {
  ctor.mockClear();
  for (const k of Object.keys(env)) delete env[k];
  env.POSTHOG_API_KEY = "phc_test_key_not_real";
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("getPosthog", () => {
  it("returns a client in production", async () => {
    env.NODE_ENV = "production";
    const { getPosthog } = await fresh();
    expect(getPosthog()).not.toBeNull();
    expect(ctor).toHaveBeenCalledWith("phc_test_key_not_real", expect.objectContaining({ host: expect.any(String) }));
  });

  it("returns null outside production without the flag, never constructs a client, and logs the reason once", async () => {
    env.NODE_ENV = "development";
    const { getPosthog } = await fresh();
    expect(getPosthog()).toBeNull();
    expect(getPosthog()).toBeNull();
    expect(ctor).not.toHaveBeenCalled();
    const lines = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes("POSTHOG_ALLOW_NONPRODUCTION"))).toHaveLength(1);
  });

  it("returns a client outside production only with POSTHOG_ALLOW_NONPRODUCTION=1", async () => {
    env.NODE_ENV = "development";
    env.POSTHOG_ALLOW_NONPRODUCTION = "1";
    const { getPosthog } = await fresh();
    expect(getPosthog()).not.toBeNull();
  });

  it("returns null with no key, in any environment", async () => {
    env.NODE_ENV = "production";
    env.POSTHOG_API_KEY = "";
    const { getPosthog } = await fresh();
    expect(getPosthog()).toBeNull();
    expect(ctor).not.toHaveBeenCalled();
  });
});

describe("posthogState", () => {
  it("reports on/off with the reason the same function decides", async () => {
    env.NODE_ENV = "development";
    const { posthogState } = await fresh();
    expect(posthogState()).toEqual({ analytics: "off", analytics_reason: expect.stringContaining("development") });
    env.NODE_ENV = "production";
    const m = await fresh();
    expect(m.posthogState()).toEqual({ analytics: "on", analytics_reason: "production" });
  });
});
