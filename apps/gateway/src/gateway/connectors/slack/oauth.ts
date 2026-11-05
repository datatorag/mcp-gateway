/**
 * Slack's OAuth v2 (SCRUM-454): its endpoints, the code exchange, and its
 * connect for the shared flow. The refresh and revoke are in `tokens.ts`.
 *
 * Built against Slack's documented behaviour for an internal app that
 * requests user scopes only, with token rotation on:
 * - the authorize URL takes the scopes in `user_scope`, never `scope` (that
 *   is the bot's, and this app asks for none);
 * - `oauth.v2.access` takes form-encoded client credentials and answers
 *   HTTP 200 with `ok`, and on `ok: false` an `error` code;
 * - the person's token, its refresh token and its `expires_in` are under
 *   `authed_user`; there is no top-level access token without bot scopes;
 * - `team` names the workspace and `is_enterprise_install` an org-wide
 *   Enterprise Grid install.
 *
 * Nothing here logs a token, a code or a response body.
 */
import { cleanWorkspaceName } from "../../untrusted-text";
import type { ConnectorOAuth } from "../../connect/connector-oauth";

export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
export const SLACK_REVOKE_URL = "https://slack.com/api/auth.revoke";
export const SLACK_USERS_INFO_URL = "https://slack.com/api/users.info";

/** Every user scope the tools need, requested at once: adding one later
 * makes every connected user reconnect. No bot scopes. */
export const SLACK_USER_SCOPES = [
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "search:read",
  "chat:write",
  "reactions:write",
  "im:write",
  "users:read",
  "users:read.email",
  "files:read",
].join(",");

/** How long one Slack OAuth call may take. */
export const SLACK_TOKEN_TIMEOUT_MS = 10_000;

/** One person's grant in one workspace, from the exchange. */
export type SlackGrant = {
  teamId: string;
  teamName: string;
  /** The Slack user id of the person who authorized. */
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scopes: string[];
  /** An org-wide Enterprise Grid install (`is_enterprise_install`). */
  enterprise: boolean;
};

/** A refused or unreadable exchange. `code` is Slack's short `error` string
 * (or a word of ours), never a body, so it is safe to log. */
export class SlackExchangeError extends Error {
  constructor(readonly code: string) {
    super(`slack exchange failed: ${code}`);
    this.name = "SlackExchangeError";
  }
}

type AccessResponse = {
  ok?: unknown;
  error?: unknown;
  team?: { id?: unknown; name?: unknown } | null;
  is_enterprise_install?: unknown;
  authed_user?: {
    id?: unknown;
    scope?: unknown;
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  } | null;
};

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v !== "";

/** Exchange an authorization code for the person's user token. Throws
 * `SlackExchangeError` on a transport failure, `ok: false`, or a response
 * missing the user token, the user id or the team id. */
export async function exchangeSlackCode(
  code: string,
  redirectUri: string,
  client: { clientId: string; clientSecret: string }
): Promise<SlackGrant> {
  let data: AccessResponse;
  try {
    const res = await fetch(SLACK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code,
        redirect_uri: redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(SLACK_TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) throw new SlackExchangeError(`http_${res.status}`);
    data = (await res.json()) as AccessResponse;
  } catch (err) {
    if (err instanceof SlackExchangeError) throw err;
    throw new SlackExchangeError("unreachable");
  }
  if (data.ok !== true) {
    throw new SlackExchangeError(nonEmpty(data.error) ? data.error.slice(0, 60) : "not_ok");
  }
  const user = data.authed_user ?? {};
  const team = data.team ?? {};
  if (!nonEmpty(user.access_token) || !nonEmpty(user.id) || !nonEmpty(team.id)) {
    throw new SlackExchangeError("incomplete_grant");
  }
  return {
    teamId: team.id,
    teamName: typeof team.name === "string" ? team.name : "",
    userId: user.id,
    accessToken: user.access_token,
    refreshToken: nonEmpty(user.refresh_token) ? user.refresh_token : null,
    expiresIn: typeof user.expires_in === "number" && user.expires_in > 0 ? user.expires_in : null,
    scopes: typeof user.scope === "string" ? user.scope.split(",").filter(Boolean) : [],
    enterprise: data.is_enterprise_install === true,
  };
}

/** The person's email from `users.info` (needs `users:read.email`), called
 * with their own new token. Null on any failure or when Slack has none:
 * the caller refuses rather than storing an account with no email. */
export async function slackUserEmail(token: string, userId: string): Promise<string | null> {
  try {
    const url = new URL(SLACK_USERS_INFO_URL);
    url.searchParams.set("user", userId);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SLACK_TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: unknown; user?: { profile?: { email?: unknown } } };
    if (data.ok !== true) return null;
    const email = data.user?.profile?.email;
    return nonEmpty(email) ? email : null;
  } catch {
    return null;
  }
}

// The company workspace only, for admins only. Slack is audience-gated, so a
// user it is not offered to gets a plain 404 at both ends: the same answer as
// a path that does not exist, like every admin refusal. User scopes only (no
// bot), and the team id is checked against SLACK_CONNECTOR_TEAM_ID before the
// new token is used for anything: the app's own distribution setting is the
// first guarantee that only the company workspace connects, this the second.
export const SLACK_CONNECT: ConnectorOAuth = {
  provider: "slack",
  path: "/auth/slack/connect",
  nonceCookie: "slack_connect_nonce",
  // The grant's own scopes are stored, from the exchange.
  scopes: null,
  storesGrantedScope: true,
  gated: true,
  notOffered: "404",
  isConfigured: (config) => Boolean(config.slackClientId && config.slackClientSecret && config.slackTeamId),

  authorizeUrl(ctx, nonce) {
    const url = new URL(SLACK_AUTHORIZE_URL);
    url.searchParams.set("client_id", ctx.config.slackClientId!);
    // User scopes only; `scope` is the bot's and is never sent.
    url.searchParams.set("user_scope", SLACK_USER_SCOPES);
    url.searchParams.set("redirect_uri", ctx.redirectUri);
    // Opens the consent screen on the company workspace; the identity step's
    // team check is what enforces it.
    url.searchParams.set("team", ctx.config.slackTeamId!);
    url.searchParams.set("state", nonce);
    return url;
  },

  async exchange(code, ctx) {
    let grant: SlackGrant;
    try {
      grant = await exchangeSlackCode(code, ctx.redirectUri, {
        clientId: ctx.config.slackClientId!,
        clientSecret: ctx.config.slackClientSecret!,
      });
    } catch (err) {
      // Slack's short error code only; never a body or a token.
      console.warn("[auth] slack exchange refused:", err instanceof SlackExchangeError ? err.code : "unknown");
      return null;
    }
    return {
      access_token: grant.accessToken,
      refresh_token: grant.refreshToken ?? undefined,
      expires_in: grant.expiresIn,
      // Space-separated, the form every stored grant uses.
      scope: grant.scopes.join(" "),
      grant,
    };
  },

  async identify(tokens, ctx) {
    const grant = tokens.raw.grant as SlackGrant;
    // An org-wide Enterprise Grid install is not one workspace.
    if (grant.enterprise) return { error: "enterprise_install_not_supported" };
    // Only the company workspace, checked before the token is used at all.
    if (grant.teamId !== ctx.config.slackTeamId) return { error: "workspace_not_allowed" };
    // connected_accounts.account_email is NOT NULL: a grant whose email
    // cannot be read is refused, not stored.
    const email = await slackUserEmail(grant.accessToken, grant.userId);
    if (!email) return null;
    return {
      email,
      // Slack reports no verified flag; the address is the workspace
      // profile's, which Slack confirmed when the person joined.
      emailVerified: true,
      externalAccountId: grant.teamId,
      // Set by whoever administers the workspace, and shown to the model and
      // in the dashboard: cleaned and capped before it is stored.
      label: cleanWorkspaceName(grant.teamName),
    };
  },
};
