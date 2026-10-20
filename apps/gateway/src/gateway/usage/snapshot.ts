import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { and, gte, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { usageEvents } from "@datatorag-mcp/db";
import { getEnv } from "@datatorag-mcp/config";
import { notInternalUserId } from "../digest";
import { getClientIp } from "../oauth/rate-limit";
import { createRateLimiter, type RateLimiter } from "./rate-limit";

/**
 * The usage snapshot for HQ's board dashboard (SCRUM-430, stage 1).
 *
 * `GET /api/admin/usage/snapshot` answers `{ as_of, excludes, calls_today }`:
 * aggregates only, and by construction nothing else. No email, no user id,
 * no error text, because the payload is built from counts and never from a
 * row.
 *
 * COMPUTED ON A CLOCK, SERVED FROM MEMORY. `usage_events` has no index on
 * `created_at` alone, so a count across all users is a scan: cheap once an
 * hour, not per request. The cron in server.ts refreshes it hourly, and once
 * at startup so a restart does not leave the endpoint empty until the next
 * hour. `as_of` says when it was computed, so a reader never takes an old
 * snapshot for a fresh one. A refresh that fails keeps the previous one.
 *
 * INTERNAL ACCOUNTS ARE LEFT OUT the way the Slack digest leaves them out
 * (`notInternalUserId`, shared rather than copied, so the two agree), and
 * the payload says so in `excludes`.
 *
 * ITS OWN AUTH. The admin routes take only the session cookie of an admin
 * user, and the dashboard is a process on a laptop, not a browser session.
 * So: a bearer token, hashed with SHA-256 and compared in constant time
 * against `USAGE_SNAPSHOT_TOKEN_SHA256`. Only the hash is in the server's
 * environment; rotating is changing it. Unset or malformed, the endpoint is
 * off. A request that fails the check is passed on to Next, which has no
 * route here and answers its ordinary 404, the same answer an admin route
 * gives a non-admin, so a probe cannot tell the endpoint exists.
 *
 * THE RATE LIMIT COMES AFTER THE TOKEN, in the order `withAdminRoute` uses
 * and for its reason: a limiter in front would answer a probe 429 after a
 * few tries on a path that otherwise 404s, which says the path is real. The
 * token is a long random secret, so guessing it is not the threat a limiter
 * in front would answer; what the limit bounds is a token holder's volume.
 */

export const USAGE_SNAPSHOT_PATH = "/api/admin/usage/snapshot";

export interface UsageSnapshot {
  as_of: string;
  excludes: "internal";
  calls_today: number;
}

const STORE = Symbol.for("datatorag.usageSnapshot");
type Store = { snapshot: UsageSnapshot | null };
const store: Store = ((globalThis as Record<symbol, unknown>)[STORE] as Store | undefined) ??
  ((globalThis as Record<symbol, unknown>)[STORE] = { snapshot: null } as Store);

export function currentUsageSnapshot(): UsageSnapshot | null {
  return store.snapshot;
}

/** Start of the current UTC day. "Today" is a UTC day, like the rollup's. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The one query: calls since the start of today, internal users left out.
 * Separate so a test can read the SQL it builds. */
export function callsTodayQuery(db: Database, now: Date) {
  return db
    .select({ calls: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(and(gte(usageEvents.createdAt, startOfUtcDay(now)), ...notInternalUserId(db, usageEvents.userId)));
}

export async function computeUsageSnapshot(db: Database, now: Date = new Date()): Promise<UsageSnapshot> {
  const [row] = await callsTodayQuery(db, now);
  // Built field by field from a count, never spread from a row, so nothing
  // but these three can reach the payload.
  return { as_of: now.toISOString(), excludes: "internal", calls_today: Number(row?.calls ?? 0) };
}

/** Compute and keep. A failure is logged and the previous snapshot stays. */
export async function refreshUsageSnapshot(db: Database, now: Date = new Date()): Promise<void> {
  try {
    store.snapshot = await computeUsageSnapshot(db, now);
  } catch (err) {
    console.error("[usage-snapshot] refresh failed; keeping the previous snapshot:", err instanceof Error ? err.message : err);
  }
}

/** True when a token hash is configured, so the endpoint and its cron are on. */
export function usageSnapshotEnabled(hash: string = getEnv().USAGE_SNAPSHOT_TOKEN_SHA256): boolean {
  return /^[0-9a-f]{64}$/.test(hash.trim().toLowerCase());
}

/** Whether `authorization` carries the token whose SHA-256 is `hash`. Both
 * sides are 32-byte digests, so the comparison is constant-time and does
 * not depend on the length of what was sent. */
export function tokenMatches(authorization: string | undefined, hash: string): boolean {
  if (!usageSnapshotEnabled(hash)) return false;
  const m = /^Bearer ([^\s]+)$/i.exec((authorization ?? "").trim());
  if (!m) return false;
  const sent = createHash("sha256").update(m[1], "utf8").digest();
  const expected = Buffer.from(hash.trim().toLowerCase(), "hex");
  return timingSafeEqual(sent, expected);
}

const minuteLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
const hourLimiter = createRateLimiter({ limit: 200, windowMs: 60 * 60_000 });
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    minuteLimiter.sweep();
    hourLimiter.sweep();
  }, 5 * 60_000).unref?.();
}

export function createUsageSnapshotHandler(opts: {
  hash?: () => string;
  snapshot?: () => UsageSnapshot | null;
  limiters?: readonly RateLimiter[];
} = {}) {
  const hash = opts.hash ?? (() => getEnv().USAGE_SNAPSHOT_TOKEN_SHA256);
  const snapshot = opts.snapshot ?? currentUsageSnapshot;
  const limiters = opts.limiters ?? [minuteLimiter, hourLimiter];
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!tokenMatches(Array.isArray(header) ? header[0] : header, hash())) {
      next();
      return;
    }
    const ip = getClientIp(req);
    const checks = limiters.map((l) => l.check(ip));
    if (checks.some((c) => !c.ok)) {
      const retryAfterMs = Math.max(...checks.map((c) => c.retryAfterMs));
      res.status(429).set("Retry-After", String(Math.ceil(retryAfterMs / 1000))).json({ error: "rate_limit" });
      return;
    }
    const current = snapshot();
    res.set("Cache-Control", "no-store");
    if (!current) {
      res.status(503).json({ error: "no_snapshot" });
      return;
    }
    res.status(200).json(current);
  };
}
