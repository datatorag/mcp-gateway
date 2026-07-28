import type { Database } from "@datatorag-mcp/db";
import { EVENTS } from "../lib/analytics";
import { getPosthog } from "../lib/posthog-server";
import { resolveUserEmail, identityProps } from "./user-email";
import type { McpSessionAction } from "./mcp-session";

/**
 * Connection-path analytics for the /mcp endpoint: the funnel between
 * copy_mcp_config (dashboard click) and tool_call (a served invocation) was
 * previously invisible — a client could connect, list tools, fail auth, or
 * never arrive, all without leaving a trace.
 *
 * Properties are counts, outcomes, and client name/version only. Request
 * bodies, tool arguments, and tool results must never be captured here.
 */

// Unauthenticated requests still get captured, under one stable anonymous
// distinct id — "requests we cannot attribute" is itself a signal — without
// minting a PostHog person per IP address.
export const MCP_ANONYMOUS_ID = "mcp_anonymous";

export type AuthFailureReason =
  | "missing_credential" // no Bearer header at all
  | "invalid" // token string matches nothing we ever issued
  | "expired"
  | "revoked";

/**
 * Classify why a bearer was rejected, from the token row fetched WITHOUT
 * liveness conditions (null = no such token). Only called for rejects; a
 * live row falls through to "invalid" harmlessly.
 */
export function classifyAuthFailure(
  row: { revokedAt: Date | null; expiresAt: Date | null } | null | undefined
): AuthFailureReason {
  if (!row) return "invalid";
  if (row.revokedAt !== null) return "revoked";
  if (row.expiresAt !== null && row.expiresAt <= new Date()) return "expired";
  return "invalid";
}

/**
 * Pull clientInfo out of an initialize request body (single message or
 * JSON-RPC batch) without touching anything else in it. Returns {} for
 * non-initialize traffic. Values are length-capped strings only.
 */
export function extractClientInfo(body: unknown): {
  name?: string;
  version?: string;
} {
  const messages = Array.isArray(body) ? body : [body];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as { method?: unknown; params?: { clientInfo?: unknown } };
    if (msg.method !== "initialize") continue;
    const ci = msg.params?.clientInfo;
    if (!ci || typeof ci !== "object") return {};
    const { name, version } = ci as { name?: unknown; version?: unknown };
    return {
      name: typeof name === "string" ? name.slice(0, 200) : undefined,
      version: typeof version === "string" ? version.slice(0, 100) : undefined,
    };
  }
  return {};
}

/**
 * Shared capture shape: same distinctId as account_connected (the gateway
 * user id) so the activation funnel joins; identity props resolved the same
 * way as every other server-side event. Never throws — analytics must not
 * break the request path. Call sites fire-and-forget with `void`.
 */
async function captureMcpEvent(
  db: Database,
  userId: string | null,
  event: string,
  properties: Record<string, unknown>
): Promise<void> {
  try {
    const c = getPosthog();
    if (!c) return;
    const email = userId ? await resolveUserEmail(db, userId) : null;
    c.capture({
      distinctId: userId ?? MCP_ANONYMOUS_ID,
      event,
      properties: {
        ...properties,
        authenticated: userId !== null,
        ...identityProps(email),
      },
    });
  } catch (err) {
    console.warn(`[mcp-analytics] ${event} capture failed`, err);
  }
}

export async function trackMcpRequestReceived(
  db: Database,
  opts: {
    userId: string | null;
    action: McpSessionAction;
    method: string;
    clientName?: string;
    clientVersion?: string;
  }
): Promise<void> {
  return captureMcpEvent(db, opts.userId, EVENTS.MCP_REQUEST_RECEIVED, {
    action: opts.action,
    http_method: opts.method,
    client_name: opts.clientName ?? null,
    client_version: opts.clientVersion ?? null,
  });
}

export async function trackMcpSessionInitialized(
  db: Database,
  userId: string,
  opts: { clientName?: string; clientVersion?: string }
): Promise<void> {
  return captureMcpEvent(db, userId, EVENTS.MCP_SESSION_INITIALIZED, {
    client_name: opts.clientName ?? null,
    client_version: opts.clientVersion ?? null,
    transport: "streamable_http",
  });
}

/** userId is non-null when the rejected token still identifies its owner
 * (expired/revoked) — those failures attribute to the real user. */
export async function trackMcpAuthFailed(
  db: Database,
  opts: { userId: string | null; reason: AuthFailureReason; method: string }
): Promise<void> {
  return captureMcpEvent(db, opts.userId, EVENTS.MCP_AUTH_FAILED, {
    reason: opts.reason,
    http_method: opts.method,
  });
}

export async function trackMcpToolsListed(
  db: Database,
  userId: string,
  toolCount: number
): Promise<void> {
  return captureMcpEvent(db, userId, EVENTS.MCP_TOOLS_LISTED, {
    tool_count: toolCount,
  });
}
