import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * SCRUM-257: the caller's agent runs for a period, each priced, with the
 * period totals. Only the caller's rows: the query is keyed on the session
 * user, never on anything in the request.
 */

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({ getSessionUserId: () => getSessionUserId() }));

const selectResults: unknown[][] = [];
const whereArgs: unknown[] = [];
function chainable(result: unknown) {
  const p = Promise.resolve(result) as Promise<unknown> & Record<string, unknown>;
  for (const m of ["from", "groupBy", "orderBy", "limit"]) p[m] = () => p;
  p.where = (arg: unknown) => {
    whereArgs.push(arg);
    return p;
  };
  return p;
}
vi.mock("@/lib/db", () => ({
  db: { select: () => chainable(selectResults.shift() ?? []) },
}));

import { GET } from "./route";

/** True when the drizzle SQL tree holds a parameter equal to `value`. The
 * tree is circular, so it is walked with a visited set, never stringified. */
function mentions(node: unknown, value: string, seen = new Set<unknown>()): boolean {
  if (node === value) return true;
  if (typeof node !== "object" || node === null || seen.has(node)) return false;
  seen.add(node);
  return Object.values(node as Record<string, unknown>).some((v) => mentions(v, value, seen));
}


const USER = "user-1";
const get = (range = "7d") => GET(new NextRequest(`http://localhost/api/usage/runs?range=${range}`));

const RUNS = [
  { runId: "r2", threadId: "t1", skill: "morning-brief", model: "claude-sonnet-5", steps: 7, inputTokens: 14, cacheReadTokens: 303_511, cacheWriteTokens: 80_858, outputTokens: 72_876, reasoningTokens: 58_191, weightedTokens: 184_099, costUsd: "0.991234", startedAt: new Date("2026-09-11T15:46:31Z"), endedAt: new Date("2026-09-11T15:59:05Z") },
  { runId: "r1", threadId: "t2", skill: null, model: "claude-sonnet-5", steps: 2, inputTokens: 50, cacheReadTokens: 35_000, cacheWriteTokens: 0, outputTokens: 900, reasoningTokens: 0, weightedTokens: 4_450, costUsd: "0.016100", startedAt: new Date("2026-09-11T10:00:00Z"), endedAt: new Date("2026-09-11T10:00:40Z") },
];

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.length = 0;
  whereArgs.length = 0;
  getSessionUserId.mockResolvedValue(USER);
});

describe("GET /api/usage/runs (SCRUM-257)", () => {
  it("401s with no session", async () => {
    getSessionUserId.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it("lists the period's runs newest first, costs as numbers, with the period totals", async () => {
    selectResults.push(RUNS);
    const res = await get("7d");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      range: string;
      runs: Array<{ runId: string; costUsd: number | null; weightedTokens: number; skill: string | null }>;
      totals: { runs: number; steps: number; weightedTokens: number; costUsd: number };
    };
    expect(body.range).toBe("7d");
    expect(body.runs.map((r) => r.runId)).toEqual(["r2", "r1"]);
    expect(body.runs[0]).toMatchObject({ skill: "morning-brief", weightedTokens: 184_099 });
    expect(body.runs[0]!.costUsd).toBeCloseTo(0.991234, 6);
    expect(body.totals).toMatchObject({ runs: 2, steps: 9, weightedTokens: 188_549 });
    expect(body.totals.costUsd).toBeCloseTo(1.007334, 6);
  });

  it("keeps an unpriced run's cost as null and leaves it out of the total rather than counting it as free", async () => {
    selectResults.push([{ ...RUNS[1]!, costUsd: null }]);
    const body = (await (await get()).json()) as { runs: Array<{ costUsd: number | null }>; totals: { costUsd: number; unpricedRuns: number } };
    expect(body.runs[0]!.costUsd).toBeNull();
    expect(body.totals.costUsd).toBe(0);
    expect(body.totals.unpricedRuns).toBe(1);
  });

  it("queries only the session user's rows", async () => {
    selectResults.push([]);
    await get();
    expect(whereArgs).toHaveLength(1);
    expect(mentions(whereArgs[0], USER)).toBe(true);
    expect(mentions(whereArgs[0], "user-2")).toBe(false);
  });
});
