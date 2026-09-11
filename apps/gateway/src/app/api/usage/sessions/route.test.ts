import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * SCRUM-257: what each session (thread) cost over a period: a sum over the
 * thread's runs, keyed on the session user.
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
const get = (range = "30d") => GET(new NextRequest(`http://localhost/api/usage/sessions?range=${range}`));

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.length = 0;
  whereArgs.length = 0;
  getSessionUserId.mockResolvedValue(USER);
});

describe("GET /api/usage/sessions (SCRUM-257)", () => {
  it("401s with no session", async () => {
    getSessionUserId.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it("returns one row per thread with its runs, steps, tokens, cost and the skills it ran", async () => {
    selectResults.push([
      { threadId: "t1", runs: 2, steps: 9, weightedTokens: 190_000, costUsd: "1.25", lastAt: new Date("2026-09-11T15:59:05Z"), skills: ["morning-brief"] },
      { threadId: "t2", runs: 1, steps: 2, weightedTokens: 4_450, costUsd: "0.0161", lastAt: new Date("2026-09-10T10:00:40Z"), skills: [] },
    ]);
    const res = await get("30d");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { range: string; sessions: Array<{ threadId: string; costUsd: number | null; skills: string[] }> };
    expect(body.range).toBe("30d");
    expect(body.sessions.map((s) => s.threadId)).toEqual(["t1", "t2"]);
    expect(body.sessions[0]!.costUsd).toBeCloseTo(1.25, 6);
    expect(body.sessions[0]!.skills).toEqual(["morning-brief"]);
    expect(body.sessions[1]!.skills).toEqual([]);
  });

  it("queries only the session user's rows", async () => {
    selectResults.push([]);
    await get();
    expect(whereArgs).toHaveLength(1);
    expect(mentions(whereArgs[0], USER)).toBe(true);
    expect(mentions(whereArgs[0], "user-2")).toBe(false);
  });
});
