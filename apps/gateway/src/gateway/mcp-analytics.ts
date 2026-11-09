import type { Database } from "@datatorag-mcp/db";
import { EVENTS } from "../lib/analytics";
import { getPosthog } from "../lib/posthog-server";
import { resolveUserEmail, identityProps } from "./user-email";
import type { AuthFailureContext } from "./auth-failure-context";
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
  | "revoked"
  // a live dashboard session presented as a bearer (SCRUM-374): a real
  // token, of the wrong kind, told apart from one we never issued
  | "wrong_token_kind";

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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The SDK's reading of a client's `elicitation` capability: `{}` is form
 * only, and each mode is otherwise declared by its own key. */
function elicitationModes(capabilities: unknown): { elicitationForm?: boolean; elicitationUrl?: boolean } {
  if (!isObject(capabilities)) return {};
  const e = capabilities.elicitation;
  if (!isObject(e)) return { elicitationForm: false, elicitationUrl: false };
  const url = isObject(e.url);
  const form = isObject(e.form) || (!("form" in e) && !("url" in e));
  return { elicitationForm: form, elicitationUrl: url };
}

/**
 * Pull clientInfo out of an initialize request body (single message or
 * JSON-RPC batch) without touching anything else in it. Returns {} for
 * non-initialize traffic. Values are length-capped strings only.
 */
export function extractClientInfo(body: unknown): {
  name?: string;
  version?: string;
  /** The protocol revision the client asked for (SCRUM-256). The SDK
   * negotiates it at initialize and keeps no getter for it, so this is the
   * one place it can be read. */
  protocolVersion?: string;
  /** Which elicitation modes the client declared (SCRUM-466), read the way
   * the SDK reads them: an empty `elicitation` object means form only.
   * Undefined when the message carried no capabilities at all. */
  elicitationForm?: boolean;
  elicitationUrl?: boolean;
} {
  const messages = Array.isArray(body) ? body : [body];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as {
      method?: unknown;
      params?: { clientInfo?: unknown; protocolVersion?: unknown; capabilities?: unknown };
    };
    if (msg.method !== "initialize") continue;
    const ci = msg.params?.clientInfo;
    if (!ci || typeof ci !== "object") return {};
    const { name, version } = ci as { name?: unknown; version?: unknown };
    const pv = msg.params?.protocolVersion;
    return {
      name: typeof name === "string" ? name.slice(0, 200) : undefined,
      version: typeof version === "string" ? version.slice(0, 100) : undefined,
      protocolVersion: typeof pv === "string" ? pv.slice(0, 50) : undefined,
      ...elicitationModes(msg.params?.capabilities),
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
  properties: Record<string, unknown>,
  opts: {
    /** Overrides "a user id was known", which is not the same claim: a
     * refused token can still name its owner (SCRUM-481). */
    authenticated?: boolean;
    /** For an anonymous caller: the id to capture under instead of
     * MCP_ANONYMOUS_ID, with no person profile made for it. */
    anonymousId?: string;
  } = {}
): Promise<void> {
  try {
    const c = getPosthog();
    if (!c) return;
    const email = userId ? await resolveUserEmail(db, userId) : null;
    const personless = userId === null && opts.anonymousId !== undefined;
    c.capture({
      distinctId: userId ?? opts.anonymousId ?? MCP_ANONYMOUS_ID,
      event,
      properties: {
        ...properties,
        authenticated: opts.authenticated ?? userId !== null,
        ...identityProps(email),
        ...(personless ? { $process_person_profile: false } : {}),
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
    /** The bearer was accepted. Stated by the caller, never inferred from
     * `userId`: an expired token still names its owner, and an open
     * discovery request (SCRUM-481) has no bearer at all. */
    authenticated: boolean;
    action: McpSessionAction;
    method: string;
    clientName?: string;
    clientVersion?: string;
    /** Answered without a bearer as discovery (SCRUM-481); its own event is
     * `mcp_discovery`. */
    openDiscovery?: boolean;
  }
): Promise<void> {
  return captureMcpEvent(
    db,
    opts.userId,
    EVENTS.MCP_REQUEST_RECEIVED,
    {
      action: opts.action,
      http_method: opts.method,
      client_name: opts.clientName ?? null,
      client_version: opts.clientVersion ?? null,
      open_discovery: opts.openDiscovery ?? false,
    },
    { authenticated: opts.authenticated }
  );
}

/** What one unauthenticated discovery request was (SCRUM-481). */
export type McpDiscovery = {
  /** The JSON-RPC method, one of the open ones. */
  method: string;
  /** From the initialize params; "" when the request carried none. */
  clientName: string;
  clientVersion: string;
  userAgent: string;
  /** From the initialize params, else the MCP-Protocol-Version header. */
  protocolVersion: string;
  /** `served`, or why it was not: over the per-IP limit, or a browser
   * Origin that is not allowed. */
  outcome: "served" | "rate_limited" | "origin_refused";
  serverSha: string;
  /** Salted hash of IP plus user agent: the distinct id. Null without a
   * salt, and then the event goes under MCP_ANONYMOUS_ID. */
  discoveryId: string | null;
  /** Salted hash of the IP alone, for joining to a browser's sign-in. */
  peerHash: string | null;
};

/** One event per unauthenticated discovery request (SCRUM-481). Under the
 * hashed id with no person profile, flagged authenticated=false; never an IP,
 * never a body beyond the client's own name and version. */
export async function trackMcpDiscovery(db: Database, d: McpDiscovery): Promise<void> {
  return captureMcpEvent(
    db,
    null,
    EVENTS.MCP_DISCOVERY,
    {
      method: d.method,
      client_name: d.clientName,
      client_version: d.clientVersion,
      user_agent: d.userAgent,
      protocol_version: d.protocolVersion,
      rate_limited: d.outcome === "rate_limited",
      outcome: d.outcome,
      server_sha: d.serverSha,
      discovery_id: d.discoveryId,
      peer_hash: d.peerHash,
    },
    { authenticated: false, anonymousId: d.discoveryId ?? undefined }
  );
}

export async function trackMcpSessionInitialized(
  db: Database,
  userId: string,
  opts: {
    clientName?: string;
    clientVersion?: string;
    elicitationForm?: boolean;
    elicitationUrl?: boolean;
  }
): Promise<void> {
  return captureMcpEvent(db, userId, EVENTS.MCP_SESSION_INITIALIZED, {
    client_name: opts.clientName ?? null,
    client_version: opts.clientVersion ?? null,
    // What the client can be asked through (SCRUM-466): whether a connect
    // link can be sent as a URL elicitation, per client, is read from here.
    elicitation_form: opts.elicitationForm ?? false,
    elicitation_url: opts.elicitationUrl ?? false,
    // Every session is OAuth since API keys were removed (SCRUM-451). Still
    // written, so a filter on the property keeps finding every session.
    auth_kind: "oauth",
    transport: "streamable_http",
  });
}

/** userId is non-null when the rejected token still identifies its owner
 * (expired/revoked) — those failures attribute to the real user. */
export async function trackMcpAuthFailed(
  db: Database,
  opts: {
    userId: string | null;
    reason: AuthFailureReason;
    method: string;
    /** Who the refused caller was, as far as a request can say (SCRUM-464):
     * see `auth-failure-context.ts`. Never a token or an email. */
    context?: AuthFailureContext;
  }
): Promise<void> {
  // reason and http_method keep their names and values: the daily reader's
  // series is built on them.
  return captureMcpEvent(db, opts.userId, EVENTS.MCP_AUTH_FAILED, {
    reason: opts.reason,
    http_method: opts.method,
    ...(opts.context ?? {}),
  });
}

/** What one tools/list says about the asker (SCRUM-256): the count split
 * into the user's connector tools and the gateway's own built-ins, and the
 * client name, version and protocol revision that listed. Counts and
 * identity only; never a tool name. */
export type ToolsListed = {
  connectorTools: number;
  builtinTools: number;
  clientName?: string | null;
  clientVersion?: string | null;
  protocolVersion?: string | null;
};

export async function trackMcpToolsListed(
  db: Database,
  userId: string,
  listed: ToolsListed
): Promise<void> {
  return captureMcpEvent(db, userId, EVENTS.MCP_TOOLS_LISTED, {
    tool_count: listed.connectorTools + listed.builtinTools,
    connector_tools: listed.connectorTools,
    builtin_tools: listed.builtinTools,
    client_name: listed.clientName ?? null,
    client_version: listed.clientVersion ?? null,
    protocol_version: listed.protocolVersion ?? null,
  });
}
