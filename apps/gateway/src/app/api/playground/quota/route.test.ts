import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({
  getSessionUserId: () => getSessionUserId(),
}));

vi.mock("@/lib/db", () => ({ db: {}, getDb: () => ({}) }));

const agentRunCap = vi.fn();
const periodStatus = vi.fn();
vi.mock("@/gateway/usage/period", () => ({
  agentRunCap: (...a: unknown[]) => agentRunCap(...a),
  periodStatus: (...a: unknown[]) => periodStatus(...a),
}));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  getSessionUserId.mockResolvedValue("user-1");
  agentRunCap.mockResolvedValue(100);
  periodStatus.mockResolvedValue({
    agentRuns: 12,
    calls: 300,
    periodStart: new Date(0),
  });
});

describe("GET /api/playground/quota", () => {
  it("reports used, cap, and remaining for a capped account", async () => {
    const res = await GET(new Request("http://localhost/api/playground/quota") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      runsUsed: 12,
      runsCap: 100,
      runsRemaining: 88,
    });
  });

  it("an exempt account serializes cap and remaining as EXPLICIT nulls", async () => {
    // The client renders null as its own state; an absent key would read as
    // "unknown" and a 0 would read as "out of runs" — both wrong for the
    // account most likely to be looking (the founder's).
    agentRunCap.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/playground/quota") as never);
    const body = await res.json();
    expect(body).toEqual({ runsUsed: 12, runsCap: null, runsRemaining: null });
  });

  it("remaining never goes negative when usage overshoots the cap", async () => {
    agentRunCap.mockResolvedValue(25);
    periodStatus.mockResolvedValue({
      agentRuns: 31,
      calls: 0,
      periodStart: new Date(0),
    });
    const body = await (
      await GET(new Request("http://localhost/api/playground/quota") as never)
    ).json();
    expect(body.runsRemaining).toBe(0);
  });

  it("requires a session", async () => {
    getSessionUserId.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/playground/quota") as never);
    expect(res.status).toBe(401);
  });
});
