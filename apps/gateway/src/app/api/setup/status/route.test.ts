import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({
  getSessionUserId: () => getSessionUserId(),
}));

// The route runs 4 selects in Promise.all order:
// connected_accounts count, legacy service_connections count, agent token, user row.
const selectResults: unknown[][] = [];
function chainable(result: unknown) {
  const p = Promise.resolve(result) as Promise<unknown> & Record<string, unknown>;
  for (const m of ["from", "where", "leftJoin", "orderBy", "limit"]) {
    p[m] = () => p;
  }
  return p;
}
vi.mock("@/lib/db", () => ({
  db: { select: () => chainable(selectResults.shift() ?? []) },
}));

import { GET } from "./route";

function prime(opts: {
  accounts?: number;
  legacy?: number;
  agent?: { clientName: string | null; createdAt: Date } | null;
  firstToolCallAt?: Date | null;
}) {
  selectResults.length = 0;
  selectResults.push(
    [{ n: opts.accounts ?? 0 }],
    [{ n: opts.legacy ?? 0 }],
    opts.agent ? [opts.agent] : [],
    [{ firstToolCallAt: opts.firstToolCallAt ?? null }]
  );
}

describe("GET /api/setup/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionUserId.mockResolvedValue("user-1");
  });

  it("401s without a session", async () => {
    getSessionUserId.mockResolvedValue(null);
    const res = await GET({} as NextRequest);
    expect(res.status).toBe(401);
  });

  it("reports a fresh user as fully disconnected", async () => {
    prime({});
    const res = await GET({} as NextRequest);
    expect(await res.json()).toEqual({
      accountConnected: false,
      agentConnected: false,
      agentClientName: null,
      agentConnectedAt: null,
      firstToolCallAt: null,
    });
  });

  it("counts legacy service connections as accountConnected", async () => {
    prime({ legacy: 1 });
    const res = await GET({} as NextRequest);
    const body = await res.json();
    expect(body.accountConnected).toBe(true);
    expect(body.agentConnected).toBe(false);
  });

  it("reports a fully activated user", async () => {
    const connectedAt = new Date("2026-07-01T00:00:00Z");
    const firstCall = new Date("2026-07-02T00:00:00Z");
    prime({
      accounts: 1,
      agent: { clientName: "Claude", createdAt: connectedAt },
      firstToolCallAt: firstCall,
    });
    const res = await GET({} as NextRequest);
    expect(await res.json()).toEqual({
      accountConnected: true,
      agentConnected: true,
      agentClientName: "Claude",
      agentConnectedAt: connectedAt.toISOString(),
      firstToolCallAt: firstCall.toISOString(),
    });
  });
});
