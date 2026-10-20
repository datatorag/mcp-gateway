/**
 * The usage snapshot endpoint (SCRUM-430). Its auth, its rate limit, the
 * internal-user exclusion it shares with the digest, and a payload with no
 * person in it.
 */
import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Database } from "@datatorag-mcp/db";

/** A drizzle that builds SQL and has no connection: the query is read, not run.
 * The cast is the `$client` brand alone, which a query builder never touches. */
const sqlOnly = () => drizzle.mock() as unknown as Database;

const envState = vi.hoisted(() => ({ INTERNAL_EXCLUDE_EMAILS: "", INTERNAL_EXCLUDE_IDS: "", USAGE_SNAPSHOT_TOKEN_SHA256: "" }));
vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => envState }));
vi.mock("../../lib/slack", () => ({ sendSlack: vi.fn() }));
vi.mock("../../lib/stripe", () => ({ getStripe: vi.fn() }));

import {
  callsTodayQuery,
  computeUsageSnapshot,
  createUsageSnapshotHandler,
  startOfUtcDay,
  tokenMatches,
  type UsageSnapshot,
} from "./snapshot";
import { createRateLimiter } from "./rate-limit";

const TOKEN = "a-test-token-that-is-long-enough";
const HASH = createHash("sha256").update(TOKEN).digest("hex");
const SNAPSHOT: UsageSnapshot = { as_of: "2026-10-20T19:00:00.000Z", excludes: "internal", calls_today: 1284 };

function call(headers: Record<string, string>, opts: Parameters<typeof createUsageSnapshotHandler>[0] = {}, ip = "198.51.100.7") {
  const res = { status: vi.fn(() => res), set: vi.fn(() => res), json: vi.fn(() => res) };
  const next = vi.fn() as unknown as NextFunction;
  const handler = createUsageSnapshotHandler({
    hash: () => HASH,
    snapshot: () => SNAPSHOT,
    limiters: [createRateLimiter({ limit: 100, windowMs: 60_000 })],
    ...opts,
  });
  handler({ headers: { "cf-connecting-ip": ip, ...headers }, socket: {} } as unknown as Request, res as unknown as Response, next);
  return { res, next: next as unknown as ReturnType<typeof vi.fn> };
}

describe("the token check", () => {
  it.each([
    ["no Authorization header", {}],
    ["a wrong token", { authorization: "Bearer not-the-token" }],
    ["the right token without the Bearer scheme", { authorization: TOKEN }],
    ["the hash itself sent as the token", { authorization: `Bearer ${HASH}` }],
  ])("%s: passed on to Next's 404, nothing answered", (_label, headers) => {
    const { res, next } = call(headers);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("the right token: the snapshot, not cached", () => {
    const { res, next } = call({ authorization: `Bearer ${TOKEN}` });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.json).toHaveBeenCalledWith(SNAPSHOT);
  });

  it("accepts the scheme in any case, and the configured hash in upper case", () => {
    expect(tokenMatches(`bearer ${TOKEN}`, HASH.toUpperCase())).toBe(true);
  });

  it.each([[""], ["not-hex"], [HASH.slice(0, 63)]])("is off when the configured hash is %j, even for the right token", (hash) => {
    const { res, next } = call({ authorization: `Bearer ${TOKEN}` }, { hash: () => hash });
    expect(next).toHaveBeenCalledOnce();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("answers 503 when authorized but nothing has been computed yet", () => {
    const { res } = call({ authorization: `Bearer ${TOKEN}` }, { snapshot: () => null });
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: "no_snapshot" });
  });
});

describe("the rate limit", () => {
  it("limits a token holder per IP and answers 429", () => {
    const limiters = [createRateLimiter({ limit: 3, windowMs: 60_000 })];
    for (let i = 0; i < 3; i++) call({ authorization: `Bearer ${TOKEN}` }, { limiters }, "198.51.100.9");
    const { res, next } = call({ authorization: `Bearer ${TOKEN}` }, { limiters }, "198.51.100.9");
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith("Retry-After", expect.any(String));
    // Another IP is unaffected.
    expect(call({ authorization: `Bearer ${TOKEN}` }, { limiters }, "198.51.100.10").res.status).toHaveBeenCalledWith(200);
  });

  it("never answers a probe without the token 429, however often it asks: always the plain 404", () => {
    // A 429 on a path that otherwise 404s would say the path is real; the
    // admin routes put their limiter after the session check for this reason.
    const limiters = [createRateLimiter({ limit: 3, windowMs: 60_000 })];
    for (let i = 0; i < 10; i++) {
      const { res, next } = call({ authorization: "Bearer wrong" }, { limiters }, "198.51.100.11");
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
  });
});

describe("internal users are left out, the way the digest leaves them out", () => {
  beforeEach(() => {
    envState.INTERNAL_EXCLUDE_IDS = "";
  });

  it("counts from the start of the UTC day and excludes users whose email is internal", () => {
    const now = new Date("2026-10-20T19:30:00Z");
    const { sql, params } = callsTodayQuery(sqlOnly(), now).toSQL();
    expect(sql).toMatch(/"usage_events"\."created_at" >= \$1/);
    expect(params[0]).toBe(startOfUtcDay(now).toISOString());
    expect(params[0]).toBe("2026-10-20T00:00:00.000Z");
    expect(sql).toMatch(/"usage_events"\."user_id" not in \(select "id" from "users" where/);
  });

  it("also excludes the configured internal user ids", () => {
    envState.INTERNAL_EXCLUDE_IDS = "0e5f6a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b,not-a-uuid";
    const { sql, params } = callsTodayQuery(sqlOnly(), new Date()).toSQL();
    expect(sql.match(/"usage_events"\."user_id" not in/g)).toHaveLength(2);
    expect(params).toContain("0e5f6a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b");
    expect(params).not.toContain("not-a-uuid");
  });
});

describe("the payload", () => {
  it("is the three fields and nothing a person could be found by, whatever the row carries", async () => {
    const leaky = { calls: 7, email: "someone@example.com", user_id: "0e5f6a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b", error: "boom" };
    const fakeDb = { select: () => ({ from: () => ({ where: async () => [leaky] }) }) } as never;
    const snapshot = await computeUsageSnapshot(fakeDb, new Date("2026-10-20T19:00:00Z"));
    expect(Object.keys(snapshot).sort()).toEqual(["as_of", "calls_today", "excludes"]);
    expect(snapshot).toEqual({ as_of: "2026-10-20T19:00:00.000Z", excludes: "internal", calls_today: 7 });
    const text = JSON.stringify(snapshot);
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});
