/**
 * Atlassian's OAuth (Jira and Confluence): the scopes the connector asks
 * for, and its connect for the shared flow. The refresh is in `tokens.ts`;
 * Atlassian is not told to drop a grant on disconnect.
 */
import type { ConnectorOAuth } from "../../connect/connector-oauth";

export const ATLASSIAN_AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
export const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
export const ATLASSIAN_ME_URL = "https://api.atlassian.com/me";

/** Jira stays on classic scopes; Confluence must be granular.
 *
 * Atlassian's classic Confluence scopes are not accepted by the Confluence
 * v2 REST API: a v2 call made with a classic grant fails
 * `401 Unauthorized; scope does not match`, not 403, so it reads like an
 * auth bug rather than a scope one. The connector calls v2 for every
 * Confluence operation except CQL search, which is why searching worked
 * while reading a page did not: `search:confluence` is already granular and
 * the v1 search endpoint accepted it.
 *
 * Each scope below is the one required by an endpoint the connector
 * actually calls. Adding a Confluence tool that hits a new v2 resource
 * needs its scope added here AND every user to reconnect, because a grant
 * is fixed at consent time.
 *
 * Jira is deliberately untouched: its tools call `/rest/api/3`, which the
 * classic Jira scopes cover, and Atlassian's guidance is to prefer classic
 * where it works.
 */
export const ATLASSIAN_SCOPES = [
  // Jira: /rest/api/3/*
  "read:jira-work",
  "write:jira-work",
  "read:jira-user",
  // Confluence: /wiki/api/v2/*
  "read:space:confluence", // GET /spaces (space key -> id lookup)
  "read:page:confluence", // GET /pages/{id}, GET /spaces/{id}/pages
  "write:page:confluence", // POST /pages, PUT /pages/{id}
  "delete:page:confluence", // DELETE /pages/{id}
  "read:comment:confluence", // GET /pages/{id}/{footer,inline}-comments
  "write:comment:confluence", // POST /footer-comments
  "read:attachment:confluence", // GET /pages/{id}/attachments
  // Confluence: /wiki/rest/api/search (v1; no v2 equivalent for CQL)
  "search:confluence",
  "read:me",
  "offline_access",
].join(" ");

export const ATLASSIAN_CONNECT: ConnectorOAuth = {
  provider: "atlassian",
  path: "/auth/atlassian/connect",
  nonceCookie: "atl_connect_nonce",
  scopes: ATLASSIAN_SCOPES,
  // The grant's own `scope`, when Atlassian reports it, is stored over the
  // requested list.
  storesGrantedScope: true,
  // Offered to everyone, with no launch gate.
  gated: false,
  notOffered: "redirect",
  isConfigured: (config) => Boolean(config.atlassianClientId && config.atlassianClientSecret),

  authorizeUrl(ctx, nonce) {
    const url = new URL(ATLASSIAN_AUTHORIZE_URL);
    url.searchParams.set("audience", "api.atlassian.com");
    url.searchParams.set("client_id", ctx.config.atlassianClientId!);
    url.searchParams.set("redirect_uri", ctx.redirectUri);
    url.searchParams.set("scope", ATLASSIAN_SCOPES);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", nonce);
    return url;
  },

  async exchange(code, ctx) {
    const res = await fetch(ATLASSIAN_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: ctx.config.atlassianClientId!,
        client_secret: ctx.config.atlassianClientSecret!,
        code,
        redirect_uri: ctx.redirectUri,
      }),
    });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  },

  // The connected account's email, from Atlassian's /me. A link with no
  // session trusts only a verified address.
  async identify(tokens) {
    const res = await fetch(ATLASSIAN_ME_URL, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    if (!res.ok) return null;
    const me = (await res.json()) as { email?: unknown; email_verified?: unknown };
    if (typeof me.email !== "string" || me.email === "") return null;
    // No label: an account's name is the user's own (set in the dashboard),
    // and a reconnect leaves it as it is.
    return { email: me.email, emailVerified: me.email_verified === true, externalAccountId: null };
  },
};
