/**
 * Slack's OAuth for its hosted MCP server: its endpoints, the code exchange,
 * and its connect for the shared flow. The refresh and revoke are in
 * `tokens.ts`.
 *
 * The tools are served by Slack's own MCP server (official-mcp-proxy), which
 * takes the user token of the `v2_user` flow (Slack's MCP server page and
 * its OAuth page):
 * - authorize at `oauth/v2_user/authorize` with the user scopes in `scope`;
 *   the app asks for no bot scopes;
 * - exchange at `oauth.v2.user.access` with form-encoded client
 *   credentials; it answers HTTP 200 with `ok`, and on `ok: false` an
 *   `error` code;
 * - the answer is shaped by the OAuth spec: the person's token, refresh
 *   token and `expires_in` at the top level, `authed_user.id` naming the
 *   person and `team.id` the workspace. Token rotation is on for the app.
 *   The older `oauth.v2.access` shape (the token under `authed_user`) is
 *   still read, so a grant from either is understood.
 *
 * Nothing here logs a token, a code or a response body.
 */
import { cleanWorkspaceName } from "../../untrusted-text";
import type { ConnectorOAuth } from "../../connect/connector-oauth";

export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2_user/authorize";
export const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.user.access";
export const SLACK_REVOKE_URL = "https://slack.com/api/auth.revoke";
export const SLACK_USERS_INFO_URL = "https://slack.com/api/users.info";

/** Every user scope Slack's MCP server supports (its `scopes_supported`),
 * requested at once: adding one later makes every connected user reconnect.
 * Which tools are served is decided by our registry, not by the grant. No
 * bot scopes. */
export const SLACK_USER_SCOPES = [
  "canvases:read",
  "canvases:write",
  "channels:history",
  "channels:read",
  "channels:write",
  "chat:write",
  "emoji:read",
  "files:read",
  "files:write",
  "groups:history",
  "groups:read",
  "groups:write",
  "im:history",
  "im:read",
  "im:write",
  "lists:read",
  "lists:write",
  "mpim:history",
  "mpim:read",
  "mpim:write",
  "reactions:read",
  "reactions:write",
  "search:read.files",
  "search:read.im",
  "search:read.mpim",
  "search:read.private",
  "search:read.public",
  "search:read.users",
  "users:read",
  "users:read.email",
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
  access_token?: unknown;
  token_type?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
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
  // The spec's place first (`oauth.v2.user.access`), then `authed_user`
  // (`oauth.v2.access`). A top-level token marked as a bot's is never the
  // person's: on `oauth.v2.access` with bot scopes the top level is the bot
  // token, and storing it as the user's would act as the bot.
  const top = data.token_type !== "bot" && nonEmpty(data.access_token);
  const accessToken = top ? data.access_token : user.access_token;
  const refreshToken = top ? data.refresh_token : user.refresh_token;
  const expiresIn = top ? data.expires_in : user.expires_in;
  const scope = top ? data.scope : user.scope;
  if (!nonEmpty(accessToken) || !nonEmpty(user.id) || !nonEmpty(team.id)) {
    throw new SlackExchangeError("incomplete_grant");
  }
  return {
    teamId: team.id,
    teamName: typeof team.name === "string" ? team.name : "",
    userId: user.id,
    accessToken,
    refreshToken: nonEmpty(refreshToken) ? refreshToken : null,
    expiresIn: typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : null,
    scopes: typeof scope === "string" ? scope.split(/[,\s]+/).filter(Boolean) : [],
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
    // On the `v2_user` endpoint `scope` is the person's; the app asks for no
    // bot scopes.
    url.searchParams.set("scope", SLACK_USER_SCOPES);
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
      // in the dashboard: cleaned and capped before it is stored. The
      // `v2_user` answer carries no team name; then none is passed, and a
      // name the user gave the account is kept.
      ...(grant.teamName ? { label: cleanWorkspaceName(grant.teamName) } : {}),
    };
  },
};
