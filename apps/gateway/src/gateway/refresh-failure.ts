import { eq, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { serviceConnections } from "@datatorag-mcp/db";
import { EVENTS } from "../lib/analytics";
import { getPosthog } from "../lib/posthog-server";
import { identityProps, resolveUserEmail } from "./user-email";

/**
 * A provider's refusal to refresh a connection's token, as a recorded fact
 * (SCRUM-190). Until this, every failed refresh reached the caller as the same
 * `null`: a revoked grant, a wrong client secret, a 429 and a timeout read
 * alike, and the user was told the account was not connected.
 */
export type RefreshFailure = {
  kind: "permanent" | "transient";
  /** A short code, never the response body: invalid_grant, invalid_client,
   * unauthorized_client, http_429, http_5xx, network, timeout, unexpected. */
  reason: string;
};

/** The OAuth `error` values that mean the grant itself is refused, matched
 * exactly. Any other value is stored as `unexpected`, never written through:
 * a provider can put anything there. */
const PERMANENT_ERRORS = new Set(["invalid_grant", "invalid_client", "unauthorized_client"]);

/**
 * Classify a refused refresh. `status` is the HTTP status, or null when the
 * request never got an answer, in which case `body` is what fetch threw. Only
 * the OAuth `error` field is read from a body; `error_description` and
 * everything else can echo request detail and are neither stored nor logged.
 *
 * An unknown answer is transient on purpose: a connection is only ever called
 * dead on a reason known to mean re-consent, because sending a user through a
 * consent flow they did not need is worse than the silence this replaces.
 */
export function classifyRefreshFailure(status: number | null, body: unknown): RefreshFailure {
  if (status === null) {
    const name = (body as { name?: unknown } | null)?.name;
    return { kind: "transient", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
  if (status === 429) return { kind: "transient", reason: "http_429" };
  if (status >= 500) return { kind: "transient", reason: "http_5xx" };
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === "string" && PERMANENT_ERRORS.has(error)) {
    // invalid_grant is permanent only as a 400 or 401, which is how every
    // provider sends it; anything else carrying it is not understood.
    if (error !== "invalid_grant" || status === 400 || status === 401) {
      return { kind: "permanent", reason: error };
    }
  }
  return { kind: "transient", reason: "unexpected" };
}

const GOOGLE_WORKSPACE = "google-workspace";

/**
 * Whether a connection needs reconnecting. Google sends `invalid_grant` only
 * for a grant that is revoked or expired, so one is enough there; anything
 * else takes two consecutive permanent failures, which costs one more failed
 * call and protects against a provider's own mistake.
 */
export function connectionDead(
  service: string,
  row: { lastRefreshError: string | null; refreshPermanentFailures: number }
): boolean {
  if (service === GOOGLE_WORKSPACE && row.lastRefreshError === "invalid_grant" && row.refreshPermanentFailures >= 1) {
    return true;
  }
  return row.refreshPermanentFailures >= 2;
}

/** The fields a successful refresh writes beside its tokens: the count resets
 * and the last error clears, so the reset rides the write a refresh already
 * makes. */
export function refreshSucceededFields(): {
  lastRefreshAt: Date;
  lastRefreshError: null;
  refreshPermanentFailures: number;
} {
  return { lastRefreshAt: new Date(), lastRefreshError: null, refreshPermanentFailures: 0 };
}

/** The same three cleared, for a reconnect: new tokens are a new grant. */
export function refreshClearedFields(): {
  lastRefreshAt: null;
  lastRefreshError: null;
  refreshPermanentFailures: number;
} {
  return { lastRefreshAt: null, lastRefreshError: null, refreshPermanentFailures: 0 };
}

/**
 * Record a failed refresh on its row and report whether the connection is now
 * dead. One UPDATE, no read first: a permanent failure adds one to the count,
 * a transient one leaves it alone, so "consecutive" counts permanent answers
 * rather than attempts. Never throws; a failed write reports not dead.
 */
export async function recordRefreshFailure(
  db: Database,
  conn: { id: string; userId: string },
  service: string,
  failure: RefreshFailure
): Promise<boolean> {
  let dead = false;
  let consecutive = 0;
  try {
    const [row] = await db
      .update(serviceConnections)
      .set({
        lastRefreshAt: new Date(),
        lastRefreshError: failure.reason,
        ...(failure.kind === "permanent"
          ? { refreshPermanentFailures: sql`${serviceConnections.refreshPermanentFailures} + 1` }
          : {}),
      })
      .where(eq(serviceConnections.id, conn.id))
      .returning({
        lastRefreshError: serviceConnections.lastRefreshError,
        refreshPermanentFailures: serviceConnections.refreshPermanentFailures,
      });
    if (row) {
      consecutive = row.refreshPermanentFailures;
      dead = connectionDead(service, row);
    }
  } catch (err) {
    console.warn(`[service-token] recording a ${service} refresh failure failed`, err);
  }
  void captureRefreshFailed(db, conn.userId, {
    service,
    reason: failure.reason,
    kind: failure.kind,
    consecutive_permanent: consecutive,
    reconnect_needed: dead,
  });
  return dead;
}

/** `service_refresh_failed`, with the acting user's identity like every
 * server event; never the account email, a token or the provider's answer.
 * Never throws. */
async function captureRefreshFailed(
  db: Database,
  userId: string,
  properties: Record<string, unknown>
): Promise<void> {
  try {
    const c = getPosthog();
    if (!c) return;
    const email = await resolveUserEmail(db, userId);
    c.capture({
      distinctId: userId,
      event: EVENTS.SERVICE_REFRESH_FAILED,
      properties: { ...properties, ...identityProps(email) },
    });
  } catch (err) {
    console.warn("[service-token] service_refresh_failed capture failed", err);
  }
}
