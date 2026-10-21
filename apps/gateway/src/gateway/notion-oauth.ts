/**
 * Notion's OAuth endpoints and client authentication (SCRUM-366), shared by
 * the connect callback (`auth.ts`) and the refresh and revoke in
 * `service-token.ts`. Its own module because those two files cannot import
 * each other without a cycle.
 *
 * Observed live in stage 0 (2026-10-21): no scopes and no PKCE; the token,
 * refresh and revoke endpoints all take HTTP Basic with the client id and
 * secret and a JSON body; the token response carries no `expires_in`.
 */

export const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
export const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";
export const NOTION_REVOKE_URL = "https://api.notion.com/v1/oauth/revoke";

/** The Authorization header for Notion's token, refresh and revoke calls. */
export function notionBasicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}
