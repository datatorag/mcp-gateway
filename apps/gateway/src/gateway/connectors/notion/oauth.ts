/**
 * Notion's OAuth (SCRUM-366): its endpoints, the client authentication, and
 * its connect for the shared flow. The refresh and revoke are in `tokens.ts`.
 *
 * Observed live in stage 0 (2026-10-21): no scopes and no PKCE; the token,
 * refresh and revoke endpoints all take HTTP Basic with the client id and
 * secret and a JSON body; the token response carries no `expires_in`.
 */

import { cleanWorkspaceName } from "../../untrusted-text";
import type { ConnectorOAuth } from "../../connect/connector-oauth";

export const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
export const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";
export const NOTION_REVOKE_URL = "https://api.notion.com/v1/oauth/revoke";

/** The Authorization header for Notion's token, refresh and revoke calls. */
export function notionBasicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

/** The fields of Notion's token response the connect reads. */
type NotionTokenResponse = {
  workspace_id?: unknown;
  workspace_name?: unknown;
  owner?: { type?: string; user?: { person?: { email?: unknown } } };
};

// No consent interstitial: Notion has no per-scope opt-out to coach around;
// the user picks pages, and capabilities are fixed on the registered
// connection. One grant is one person in one workspace, so the workspace id
// is the account's external id and its name the label; a second workspace
// under the same email is a second account.
export const NOTION_CONNECT: ConnectorOAuth = {
  provider: "notion",
  path: "/auth/notion/connect",
  nonceCookie: "notion_connect_nonce",
  // Notion grants no scopes: access is the pages the user picks.
  scopes: null,
  gated: true,
  notOffered: "redirect",
  isConfigured: (config) => Boolean(config.notionClientId && config.notionClientSecret),

  authorizeUrl(ctx, nonce) {
    const url = new URL(NOTION_AUTHORIZE_URL);
    url.searchParams.set("client_id", ctx.config.notionClientId!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("owner", "user");
    url.searchParams.set("redirect_uri", ctx.redirectUri);
    url.searchParams.set("state", nonce);
    return url;
  },

  async exchange(code, ctx) {
    const res = await fetch(NOTION_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: notionBasicAuth(ctx.config.notionClientId!, ctx.config.notionClientSecret!),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: ctx.redirectUri }),
    });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  },

  async identify(tokens) {
    const raw = tokens.raw as NotionTokenResponse;
    // The person who authorized, from the token response itself: Notion has
    // no userinfo call to make. Absent when the connection lacks the "user
    // information with email" capability, and then there is no routing key.
    const email = raw.owner?.user?.person?.email;
    if (typeof email !== "string" || email === "") return null;
    // Without the workspace id a second workspace under the same email would
    // overwrite the first one's tokens, which is the thing the key exists to
    // prevent, so a grant with none is refused rather than stored keyless.
    if (typeof raw.workspace_id !== "string" || raw.workspace_id === "") return { error: "could_not_resolve_workspace" };
    return {
      email,
      // Notion reports no verified flag; the address is the one its own
      // sign-in uses.
      emailVerified: true,
      externalAccountId: raw.workspace_id,
      // Set by whoever administers the workspace, and shown to the model and
      // in the dashboard: cleaned and capped before it is stored.
      label: cleanWorkspaceName(raw.workspace_name),
    };
  },
};
