/**
 * Slack's OAuth v2 endpoints and the code exchange (SCRUM-454), shared by
 * the connect callback (`auth.ts`) and the refresh and revoke in
 * `service-token.ts`. Its own module, as `notion-oauth.ts` is, because those
 * two files cannot import each other without a cycle.
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
