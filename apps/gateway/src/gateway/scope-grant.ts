/**
 * The one place that compares what a user GRANTED against what the product
 * NEEDS (SCRUM-136, foundation shape from SCRUM-105).
 *
 * Google's consent screen lets a user untick individual scopes. The connect
 * flow stores whatever came back (`service_connections.scopes`), and before
 * this module nothing ever compared it to the request. Every consumer here
 * receives the finished delta — what is granted, what is missing, whether the
 * connection is complete — because a caller handed a raw scope array
 * re-derives "is this enough" itself, and every caller derives it slightly
 * differently. The comparison lives here and nowhere else.
 *
 * There is deliberately NO stored status column: partial-ness is derived at
 * read time from the scopes string the callback already stores. A second copy
 * would drift the first time either side changed.
 */

/** The full Google Workspace request, as a list. `auth.ts` joins this for the
 * consent redirect; this module compares against it. One list, not a string
 * and a copy. */
export const GWS_SCOPE_LIST = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/tasks",
] as const;

export const GOOGLE_WORKSPACE_SERVICE = "google-workspace";

/**
 * Google STORES some scopes in a different spelling than the one we REQUEST:
 * we ask for `email`, the granted string comes back as
 * `https://www.googleapis.com/auth/userinfo.email` (confirmed against
 * production rows). Without this table a naive set-compare marks every FULL
 * grant as partial, which is the exact opposite of this module's job.
 */
const GRANTED_ALIASES: Record<string, string> = {
  "https://www.googleapis.com/auth/userinfo.email": "email",
  "https://www.googleapis.com/auth/userinfo.profile": "profile",
};

/** The eight API scopes a user can actually untick, with the word each one is
 * called in front of a user. Scope URLs never reach a user; these names do.
 * The identity scopes (`openid`, `email`) are not on Google's untickable
 * list, so they can never be "missing" here — and the connect callback fails
 * earlier anyway if it cannot resolve the account email.
 *
 * `iconKey` is STATED, not derived from `displayName.toLowerCase()`
 * (SCRUM-106). The lowercase form happens to match every `ServiceIcon` key
 * today, and a display name is copy: renaming "Docs" to "Google Docs" is a
 * copy edit that would silently swap eight brand marks for the fallback
 * glyph. An explicit column makes that a type error instead, and
 * `scope-grant.icons.test.ts` pins the join against the icon component's own
 * known-service set. */
const API_SCOPES: ReadonlyArray<{
  scope: string;
  displayName: string;
  iconKey: string;
}> = [
  { scope: "https://www.googleapis.com/auth/gmail.modify", displayName: "Gmail", iconKey: "gmail" },
  { scope: "https://www.googleapis.com/auth/drive", displayName: "Drive", iconKey: "drive" },
  { scope: "https://www.googleapis.com/auth/calendar", displayName: "Calendar", iconKey: "calendar" },
  { scope: "https://www.googleapis.com/auth/documents", displayName: "Docs", iconKey: "docs" },
  { scope: "https://www.googleapis.com/auth/spreadsheets", displayName: "Sheets", iconKey: "sheets" },
  { scope: "https://www.googleapis.com/auth/presentations", displayName: "Slides", iconKey: "slides" },
  { scope: "https://www.googleapis.com/auth/contacts", displayName: "Contacts", iconKey: "contacts" },
  { scope: "https://www.googleapis.com/auth/tasks", displayName: "Tasks", iconKey: "tasks" },
];

export type MissingScope = { scope: string; displayName: string };

export type ScopeDelta = {
  /** Every granted scope, alias-normalized. */
  granted: string[];
  /** The required API scopes the grant does not cover. */
  missing: MissingScope[];
  complete: boolean;
};

/** One service, and whether this grant covers it. SCRUM-106 renders these;
 * nothing recomputes "is this enough" from them. */
export type ServiceGrantState = {
  displayName: string;
  /** `ServiceIcon` key for the brand mark (SCRUM-97). Never a scope URL. */
  iconKey: string;
  granted: boolean;
};

function normalize(scope: string): string {
  return GRANTED_ALIASES[scope] ?? scope;
}

/**
 * Every service the product asks for, each marked granted or not (SCRUM-106).
 *
 * `scopeDelta` answers "what is MISSING", which is the whole question for a
 * banner and for the pre-call gate. A per-service view needs the other half
 * too: you cannot render "Gmail and Drive work, Calendar does not" from a
 * missing-list alone, because nothing outside this module knows what the full
 * set even is. Rather than export `API_SCOPES` and let each caller re-derive
 * the join — the exact drift this module exists to prevent — the finished
 * per-service answer is computed here, off the same list and the same
 * normalization `scopeDelta` uses.
 *
 * Empty for anything that is not Google Workspace: no other connector has a
 * per-scope opt-out, so there is no per-service state to show. Callers render
 * nothing rather than a fabricated all-green list.
 */
export function serviceGrantStates(
  service: string,
  granted: string | null | undefined
): ServiceGrantState[] {
  if (service !== GOOGLE_WORKSPACE_SERVICE) return [];
  // Deliberately reuses scopeDelta rather than re-splitting the string: one
  // parse, one alias table, one definition of "granted" (SCRUM-136).
  const { missing } = scopeDelta(service, granted);
  const missingScopes = new Set(missing.map((m) => m.scope));
  return API_SCOPES.map(({ displayName, iconKey, scope }) => ({
    displayName,
    iconKey,
    granted: !missingScopes.has(scope),
  }));
}

/**
 * The delta between what `service` needs and what `granted` covers.
 *
 * `granted` is the space-separated string the token exchange returned (and
 * the callback stored). `null` reads as COMPLETE, deliberately fail-open: it
 * means a legacy row this module knows nothing about, and a false "reconnect"
 * nag on a working connection is worse than staying quiet. Services other
 * than Google Workspace are trivially complete — Atlassian's consent screen
 * has no per-scope opt-out — through the same code path, not a special case.
 */
export function scopeDelta(
  service: string,
  granted: string | null | undefined
): ScopeDelta {
  const grantedList = (granted ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map(normalize);

  if (service !== GOOGLE_WORKSPACE_SERVICE || granted == null) {
    return { granted: grantedList, missing: [], complete: true };
  }

  const grantedSet = new Set(grantedList);
  // Projected to {scope, displayName}, NOT spread. `API_SCOPES` also carries
  // `iconKey`, which is presentation for SCRUM-106's panel and has no business
  // in the payload the agent reads or the MCP surface relays. Spreading would
  // have widened a shipped contract as a side effect of adding a column.
  const missing = API_SCOPES.filter((s) => !grantedSet.has(s.scope)).map(
    ({ scope, displayName }) => ({ scope, displayName })
  );
  return { granted: grantedList, missing, complete: missing.length === 0 };
}

/**
 * Tool-name prefix → the API scope that tool cannot run without.
 *
 * Only ever consulted for Google Workspace tools (the caller passes the
 * connector type precisely so an identically-prefixed tool from some future
 * connector cannot be checked against Google's scopes). Anything unmapped —
 * `gws_run`, `gws_auth_*`, every Atlassian tool — makes no static claim and
 * falls through to the call itself; the 403 rewrite below is the net for
 * those. Fail-open on purpose: a wrong block here refuses work the user
 * could do, while a missed block just reproduces today's behaviour.
 *
 * THE MAP UNDER-BLOCKS BY DESIGN — do not "fix" it into a multi-scope check.
 * A cross-service tool (`gmail_save_attachment_to_drive` needs Gmail AND
 * Drive) is checked on its prefix scope only; if the second scope is the
 * missing one, the 403 rewrite catches it after the fact. Making this map
 * fail-closed would mean a wrong or stale entry blocks calls that would have
 * worked — the one failure mode worse than the bug this module fixes.
 * Ruled by HQ, see SCRUM-136.
 */
const TOOL_PREFIX_SCOPE: ReadonlyArray<{ prefix: string; scope: string }> = [
  { prefix: "gmail_", scope: "https://www.googleapis.com/auth/gmail.modify" },
  { prefix: "drive_", scope: "https://www.googleapis.com/auth/drive" },
  { prefix: "docs_", scope: "https://www.googleapis.com/auth/documents" },
  { prefix: "sheets_", scope: "https://www.googleapis.com/auth/spreadsheets" },
  { prefix: "slides_", scope: "https://www.googleapis.com/auth/presentations" },
  { prefix: "calendar_", scope: "https://www.googleapis.com/auth/calendar" },
  { prefix: "contacts_", scope: "https://www.googleapis.com/auth/contacts" },
  { prefix: "tasks_", scope: "https://www.googleapis.com/auth/tasks" },
];

function displayNameFor(scope: string): string | null {
  return API_SCOPES.find((s) => s.scope === scope)?.displayName ?? null;
}

/** The tool half of a possibly-namespaced name (`gws-mcp__gmail_send` or
 * plain `gmail_send`). */
function plainToolName(toolName: string): string {
  const sep = toolName.indexOf("__");
  return sep === -1 ? toolName : toolName.slice(sep + 2);
}

export function requiredScopeForTool(toolName: string): MissingScope | null {
  const plain = plainToolName(toolName);
  const hit = TOOL_PREFIX_SCOPE.find((e) => plain.startsWith(e.prefix));
  if (!hit) return null;
  return { scope: hit.scope, displayName: displayNameFor(hit.scope) ?? hit.scope };
}

export type Surface = "mcp" | "agent";

/**
 * The words a user (or their agent) reads instead of a raw Google error.
 *
 * Two audiences: on the MCP surface the text is relayed by the user's own
 * client, so it carries the absolute reconnect URL. On the agent surface the
 * text instructs OUR model, which has `request_connection` to render an
 * inline reconnect control — a link would be the weaker path there.
 */
export function missingScopeMessage(opts: {
  displayName: string | null;
  surface: Surface;
  /** Absolute connections URL; required for the MCP surface. */
  connectionsUrl?: string;
}): string {
  const what = opts.displayName
    ? `${opts.displayName} access`
    : "a Google permission this tool needs";
  if (opts.surface === "mcp") {
    const url = opts.connectionsUrl ?? "the DataToRAG dashboard";
    return (
      `Google Workspace is connected, but ${what} was not granted on the ` +
      `consent screen, so this tool cannot run. To grant it, reconnect ` +
      `Google Workspace at ${url} and allow it there, then try again.`
    );
  }
  return (
    `The user's Google Workspace connection does not include ${what}; ` +
    `they did not grant that permission on the consent screen. Tell the ` +
    `user plainly what is not granted, then call the request_connection ` +
    `tool with service "${GOOGLE_WORKSPACE_SERVICE}" so they get a ` +
    `reconnect control. Do not show them a raw error message.`
  );
}

export type ScopeCheck =
  | { ok: true }
  | { ok: false; missing: MissingScope; message: string };

/**
 * The SCRUM-107 pre-call check: refuse before dispatch when the scope a tool
 * needs is known-missing from the account the call would run as.
 */
export function checkScopeForTool(opts: {
  toolName: string;
  /** Connector type of the tool's plugin, e.g. "google-workspace". */
  service: string | null | undefined;
  /** The granted-scopes string of the resolved connection row. */
  granted: string | null | undefined;
  surface: Surface;
  connectionsUrl?: string;
}): ScopeCheck {
  if (opts.service !== GOOGLE_WORKSPACE_SERVICE) return { ok: true };
  const required = requiredScopeForTool(opts.toolName);
  if (!required) return { ok: true };
  const delta = scopeDelta(opts.service, opts.granted);
  if (!delta.missing.some((m) => m.scope === required.scope)) return { ok: true };
  return {
    ok: false,
    missing: required,
    message: missingScopeMessage({
      displayName: required.displayName,
      surface: opts.surface,
      connectionsUrl: opts.connectionsUrl,
    }),
  };
}

/** Marker prefixed onto the metered error message when the pre-call check
 * refuses, so instrumentation can tell a blocked call from a Google 403 —
 * a block the metrics cannot see would be a one-sided measurement of exactly
 * the failure SCRUM-136 is about. */
export const MISSING_SCOPE_ERROR_MARKER = "[missing-scope]";

/** Google's insufficient-scope shapes, as they surface through the plugin.
 *
 * VERIFIED LIVE 2026-08-20: a tool call under a real short grant returned
 * `Error: API error: {"error":{"code":403,"message":"Request had
 * insufficient authentication scopes.","reason":"insufficientPermissions"}}`
 * through the plugin, matched by two of the three alternatives below (the
 * captured string is pinned in scope-grant.test.ts). The third,
 * ACCESS_TOKEN_SCOPE_INSUFFICIENT, is Google's documented detail-reason for
 * the same condition and kept as belt-and-braces.
 *
 * PERMISSION_DENIED alone is deliberately absent: that also covers
 * file-level sharing refusals, which are not scope problems and must keep
 * their own message. */
const SCOPE_ERROR_PATTERNS =
  /insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i;

/**
 * The at-failure net: when a tool result is an error whose text matches
 * Google's insufficient-scope shapes, the worded message replaces it. Returns
 * null when the error is not a scope error — callers pass everything through
 * and only act on a match.
 */
export function rewriteScopeError(opts: {
  toolName: string;
  service: string | null | undefined;
  errorText: string | null | undefined;
  surface: Surface;
  connectionsUrl?: string;
}): string | null {
  if (opts.service !== GOOGLE_WORKSPACE_SERVICE) return null;
  if (!opts.errorText || !SCOPE_ERROR_PATTERNS.test(opts.errorText)) return null;
  const required = requiredScopeForTool(opts.toolName);
  return missingScopeMessage({
    displayName: required?.displayName ?? null,
    surface: opts.surface,
    connectionsUrl: opts.connectionsUrl,
  });
}
