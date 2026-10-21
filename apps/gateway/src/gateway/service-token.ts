import { eq, and, desc, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { serviceConnections, connectedAccounts } from "@datatorag-mcp/db";
import { revokeGoogleToken } from "@/lib/google-revoke";
import { NOTION_REVOKE_URL, NOTION_TOKEN_URL, notionBasicAuth } from "./notion-oauth";

/** Mapping from plugin slug to the service connection it needs. */
export const PLUGIN_SERVICE_MAP: Record<string, string> = {
  "gws-mcp": "google-workspace",
  "atlassian-mcp": "atlassian",
  "notion-mcp": "notion",
};

/** Reverse mapping: service name to plugin slug. */
export const SERVICE_PLUGIN_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(PLUGIN_SERVICE_MAP).map(([slug, service]) => [service, slug])
);

/**
 * Refresh a Google access token using the stored refresh token.
 */
async function refreshGoogleToken(
  db: Database,
  connectionId: string,
  refreshToken: string
): Promise<string | null> {
  const clientId = process.env.GOOGLE_GWS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GWS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    await db
      .update(serviceConnections)
      .set({
        accessToken: data.access_token,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(serviceConnections.id, connectionId));

    return data.access_token;
  } catch {
    return null;
  }
}

/**
 * Refresh an Atlassian access token.
 * Atlassian uses rotating refresh tokens — the response includes a new
 * refresh_token that must replace the old one.
 */
async function refreshAtlassianToken(
  db: Database,
  connectionId: string,
  refreshToken: string
): Promise<string | null> {
  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    // Atlassian rotates refresh tokens — store the new one
    await db
      .update(serviceConnections)
      .set({
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? refreshToken,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(serviceConnections.id, connectionId));

    return data.access_token;
  } catch {
    return null;
  }
}

/** How long a Notion token call may hold the row lock before giving up. */
const NOTION_TOKEN_TIMEOUT_MS = 10_000;

/**
 * Refresh a Notion access token (SCRUM-366), under a row lock.
 *
 * Notion rotates BOTH tokens on every refresh, and stage 0 observed the rule
 * that makes an unlocked refresh dangerous: the old pair stays valid until the
 * new access token is first used, and until then presenting the old refresh
 * token again SUCCEEDS and invalidates the newer, unused pair. Two calls
 * refreshing at once with the same refresh token therefore both succeed, and
 * one caller walks away with a token Notion has already killed. So:
 *
 * - The row is read `FOR UPDATE` inside a transaction, and the stored refresh
 *   token is compared with the one this caller presented. If another caller
 *   already rotated it, the stored access token is the answer and Notion is
 *   not asked again.
 * - Notion is called while the lock is held, and the new pair is written in
 *   the same transaction, so it is persisted before anyone is handed the new
 *   access token. If the commit fails, the old pair still stands at Notion,
 *   because the new access token was never used.
 * - On `invalid_grant` the row is read again (locked, so a writer queued
 *   behind this one, such as a reconnect, lands first) before the grant is
 *   called dead: if its refresh token has moved, the stored access token is
 *   used.
 *
 * Exported for its tests. Reached through REFRESH_FN only when a stored
 * expiry has passed, and Notion rows store none (Notion sends no
 * `expires_in`, and stage 0 has not yet observed one), so this does not run
 * on any call path today.
 */
export async function refreshNotionToken(
  db: Database,
  connectionId: string,
  presentedRefreshToken: string
): Promise<string | null> {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID;
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  type Outcome = { token: string } | { rejected: true } | { failed: true };
  let outcome: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      const [row] = await tx
        .select({
          accessToken: serviceConnections.accessToken,
          refreshToken: serviceConnections.refreshToken,
        })
        .from(serviceConnections)
        .where(eq(serviceConnections.id, connectionId))
        .for("update");
      if (!row) return { failed: true };
      // Someone else rotated while this caller waited: theirs is current.
      if (row.refreshToken !== presentedRefreshToken) {
        return { token: row.accessToken };
      }

      const res = await fetch(NOTION_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: notionBasicAuth(clientId, clientSecret),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: presentedRefreshToken,
        }),
        signal: AbortSignal.timeout(NOTION_TOKEN_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        return body?.error === "invalid_grant" ? { rejected: true } : { failed: true };
      }
      const data = (await res.json()) as {
        access_token?: unknown;
        refresh_token?: unknown;
      };
      if (typeof data.access_token !== "string") return { failed: true };

      await tx
        .update(serviceConnections)
        .set({
          accessToken: data.access_token,
          refreshToken:
            typeof data.refresh_token === "string"
              ? data.refresh_token
              : presentedRefreshToken,
          // Notion sends no expiry, and none is invented.
          tokenExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(serviceConnections.id, connectionId));
      return { token: data.access_token };
    });
  } catch {
    return null;
  }

  if ("token" in outcome) return outcome.token;
  if ("failed" in outcome) return null;

  // invalid_grant. Before calling the grant dead, look again: a writer that
  // does not take this lock (a reconnect) may have been queued behind it.
  try {
    const [row] = await db.transaction((tx) =>
      tx
        .select({
          accessToken: serviceConnections.accessToken,
          refreshToken: serviceConnections.refreshToken,
        })
        .from(serviceConnections)
        .where(eq(serviceConnections.id, connectionId))
        .for("update")
    );
    if (row && row.refreshToken !== presentedRefreshToken) {
      return row.accessToken;
    }
  } catch {
    return null;
  }
  console.warn("[service-token] notion refresh refused (invalid_grant); the workspace needs reconnecting");
  return null;
}

/** Service-specific refresh function lookup. */
const REFRESH_FN: Record<
  string,
  (db: Database, connId: string, rt: string) => Promise<string | null>
> = {
  "google-workspace": refreshGoogleToken,
  atlassian: refreshAtlassianToken,
  notion: refreshNotionToken,
};

/** Revoke one Notion token. Never throws. */
async function revokeNotionToken(token: string): Promise<boolean> {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID;
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return false;
  try {
    const res = await fetch(NOTION_REVOKE_URL, {
      method: "POST",
      headers: {
        Authorization: notionBasicAuth(clientId, clientSecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(NOTION_TOKEN_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Revoke BOTH Notion tokens. Stage 0 saw a revoked token die at once, but
 * not whether revoking one of the pair kills the other, so neither is left
 * to chance. True when either call was accepted. */
async function revokeNotionGrant(tokens: {
  accessToken?: string | null;
  refreshToken?: string | null;
}): Promise<boolean> {
  const results = await Promise.all(
    [tokens.accessToken, tokens.refreshToken]
      .filter((t): t is string => typeof t === "string" && t !== "")
      .map(revokeNotionToken)
  );
  return results.some(Boolean);
}

/** Service-specific upstream revocation, beside REFRESH_FN because this is
 * the same dispatch: per-provider OAuth mechanics keyed by service. A
 * provider with no entry simply has no upstream revocation yet — adding one
 * is a row here, not another branch at the call sites.
 *
 * Atlassian is absent deliberately: its revocation story is its own piece of
 * work and guessing at it would be worse than the honest gap. */
type RevokeTokens = { accessToken?: string | null; refreshToken?: string | null };

/** Revoking the REFRESH token kills a Google grant including its derived
 * access tokens, so prefer it and fall back to the access token. */
async function revokeGoogleGrant(tokens: RevokeTokens): Promise<boolean> {
  const token = tokens.refreshToken ?? tokens.accessToken;
  if (!token) return false;
  return revokeGoogleToken(token);
}

const REVOKE_FN = new Map<string, (tokens: RevokeTokens) => Promise<boolean>>([
  ["google-workspace", revokeGoogleGrant],
  ["notion", revokeNotionGrant],
]);

/** Tell the provider to drop a connection's grant before we forget it
 * locally.
 *
 * Deleting only our rows leaves the grant live upstream, where a previously
 * leaked refresh token keeps working. Which token(s) each provider is sent
 * is the provider entry's own decision (see REVOKE_FN).
 *
 * Strictly best effort, and deliberately never throws: a user who clicked
 * disconnect must never stay connected because a provider was slow or down.
 * The caller deletes regardless of what this returns. */
export async function revokeUpstream(
  service: string,
  tokens: { accessToken?: string | null; refreshToken?: string | null }
): Promise<boolean> {
  // A Map, not an object literal: `service` reaches here from a query
  // parameter, and a plain object would resolve "__proto__" or "constructor"
  // to something that is not a revoke function.
  const revoke = REVOKE_FN.get(service);
  if (!revoke) return false;
  return revoke(tokens);
}

/** A token together with the ACCOUNT it belongs to.
 *
 * The account half exists for usage attribution (SCRUM-78): when
 * the caller names no account, the gateway still resolves one — the default —
 * and discarding that identity left every agent-surface usage row with a null
 * `account_email`, which is exactly the field metered billing would bill on.
 * Whoever resolves the token is the only party that knows which account it
 * came from, so it says so here. `accountEmail` is null only on the legacy
 * un-migrated path, where the row genuinely has no account attached. */
export type ResolvedServiceToken = {
  token: string;
  accountEmail: string | null;
  /** The granted-scopes string of the resolved connection row (SCRUM-136).
   * Travels with the token because the scope check must judge the account
   * the call will actually run as, not "the" connection. Null on legacy rows
   * that never stored one. */
  scopes: string | null;
};

/** One account an ambiguous `account` value could have meant, and the value
 * that names it alone. */
export type AccountChoice = {
  /** What to pass as `account` to reach this one and nothing else. */
  account: string;
  email: string;
  /** The workspace name, for connectors with one (Notion). */
  workspace: string | null;
};

/** An `account` value that names more than one connected account. Refused,
 * never guessed: a guess is a call that may run, or write, as an account the
 * caller did not mean (SCRUM-366). */
export type AmbiguousAccount = {
  ambiguous: true;
  choices: AccountChoice[];
  /** Never present, so a caller that reads a token off a refusal without
   * checking `ambiguous` gets nothing and fails closed, as if no account
   * matched, rather than failing to compile at every existing call site. */
  token?: never;
  accountEmail?: never;
  scopes?: never;
};

/** The words for an ambiguous account. `requested` is shown as given, so the
 * caller passes it already made safe to echo. */
export function ambiguousAccountMessage(
  requested: string,
  choices: AccountChoice[]
): string {
  const listed = choices
    .map((c) =>
      c.workspace
        ? `"${c.account}" (${c.email}, workspace ${c.workspace})`
        : `"${c.account}" (${c.email})`
    )
    .join("; ");
  return `"${requested}" matches more than one connected account. Pass one of these as the account argument: ${listed}.`;
}

type AccountRow = {
  email: string;
  label: string | null;
  externalAccountId: string | null;
};

/** Whether `value` names this account. An email always does. A label or
 * external id does only on a row that carries an external id, which today
 * means a Notion workspace: a Google or Atlassian label is a display string,
 * never an address, so their routing is exactly what it was. */
function accountMatches(row: AccountRow, value: string): boolean {
  if (row.email === value) return true;
  if (row.externalAccountId === null) return false;
  return row.label === value || row.externalAccountId === value;
}

/** The value that reaches `row` alone among `all`: the workspace name when it
 * is unique, else the workspace id, else the email. */
function choiceFor(row: AccountRow, all: AccountRow[]): AccountChoice {
  const unique = (v: string | null): v is string =>
    v !== null && all.filter((r) => accountMatches(r, v)).length === 1;
  const account = [row.label, row.externalAccountId, row.email].find(unique) ??
    row.externalAccountId ??
    row.email;
  return { account, email: row.email, workspace: row.externalAccountId !== null ? row.label : null };
}

/**
 * Get a valid access token for a user's service connection, together with the
 * account it was resolved for.
 * Routes through connected_accounts when available, with fallback to direct lookup.
 * Refreshes if expired and refresh token is available.
 *
 * `account` is matched against the account email; for an account carrying an
 * external id (a Notion workspace) also against its label (the workspace
 * name) and the id itself. A value matching more than one account is
 * refused with the choices (`AmbiguousAccount`), never resolved.
 */
export async function resolveServiceToken(
  db: Database,
  userId: string,
  service: string,
  accountEmail?: string
): Promise<ResolvedServiceToken | AmbiguousAccount | null> {
  type ConnRow = {
    id: string;
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
    scopes: string | null;
    /** Null only on the legacy path, where no connected_accounts row exists
     * and there is genuinely no account identity to report. */
    accountEmail: string | null;
  };

  const connColumns = {
    id: serviceConnections.id,
    accessToken: serviceConnections.accessToken,
    refreshToken: serviceConnections.refreshToken,
    tokenExpiresAt: serviceConnections.tokenExpiresAt,
    scopes: serviceConnections.scopes,
    accountEmail: connectedAccounts.accountEmail,
  };
  const forUser = [
    eq(connectedAccounts.userId, userId),
    eq(connectedAccounts.connectorType, service),
  ];

  let conn: ConnRow | undefined;
  if (accountEmail) {
    // Every account the user holds for this service, so a value can be
    // judged ambiguous and each choice offered by a value that is not. A
    // user's accounts for one service are a handful of rows.
    const rows = await db
      .select({
        ...connColumns,
        label: connectedAccounts.label,
        externalAccountId: connectedAccounts.externalAccountId,
      })
      .from(connectedAccounts)
      .innerJoin(
        serviceConnections,
        eq(connectedAccounts.serviceConnectionId, serviceConnections.id)
      )
      .where(and(...forUser));
    const asAccount = (r: (typeof rows)[number]): AccountRow => ({
      email: r.accountEmail,
      label: r.label,
      externalAccountId: r.externalAccountId,
    });
    const all = rows.map(asAccount);
    const matches = rows.filter((r) => accountMatches(asAccount(r), accountEmail));
    if (matches.length > 1) {
      return {
        ambiguous: true,
        choices: matches.map((m) => choiceFor(asAccount(m), all)),
      };
    }
    conn = matches[0];
  } else {
    conn = (
      await db
        .select(connColumns)
        .from(connectedAccounts)
        .innerJoin(
          serviceConnections,
          eq(connectedAccounts.serviceConnectionId, serviceConnections.id)
        )
        .where(and(...forUser, eq(connectedAccounts.isDefault, true)))
        .limit(1)
    )[0];
  }

  // Fallback: direct lookup for un-migrated rows (no explicit account requested)
  if (!conn && !accountEmail) {
    const [legacy] = await db
      .select({
        id: serviceConnections.id,
        accessToken: serviceConnections.accessToken,
        refreshToken: serviceConnections.refreshToken,
        tokenExpiresAt: serviceConnections.tokenExpiresAt,
        scopes: serviceConnections.scopes,
      })
      .from(serviceConnections)
      .where(
        and(
          eq(serviceConnections.userId, userId),
          eq(serviceConnections.service, service)
        )
      )
      // A token lookup must never depend on heap order (SCRUM-145): widest
      // grant first, then most recent, then id so the pick can never flap
      // between two calls for the same user.
      .orderBy(
        sql`length(${serviceConnections.scopes}) DESC NULLS LAST`,
        desc(serviceConnections.connectedAt),
        serviceConnections.id
      )
      .limit(1);
    if (legacy) conn = { ...legacy, accountEmail: null };
  }

  if (!conn) return null;
  const resolvedEmail = conn.accountEmail;

  const isExpired =
    conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() < Date.now();

  if (!isExpired)
    return {
      token: conn.accessToken,
      accountEmail: resolvedEmail,
      scopes: conn.scopes,
    };

  if (conn.refreshToken) {
    const refreshFn = REFRESH_FN[service];
    if (refreshFn) {
      const newToken = await refreshFn(db, conn.id, conn.refreshToken);
      // A refresh never widens the grant, so the stored scopes still hold.
      if (newToken)
        return { token: newToken, accountEmail: resolvedEmail, scopes: conn.scopes };
    }
  }

  return null;
}

/** The token alone, for call sites that do not report usage. */
export async function getServiceToken(
  db: Database,
  userId: string,
  service: string,
  accountEmail?: string
): Promise<string | null> {
  const resolved = await resolveServiceToken(db, userId, service, accountEmail);
  if (!resolved || "ambiguous" in resolved) return null;
  return resolved.token;
}
