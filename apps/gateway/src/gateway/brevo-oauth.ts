/**
 * Brevo's OAuth endpoints and the scopes the connector asks for (SCRUM-468),
 * shared by the connect callback (`auth.ts`) and the refresh and revoke in
 * `service-token.ts`. Its own module because those two files cannot import
 * each other without a cycle.
 *
 * Brevo's partner realm. A private app authenticates the token, refresh and
 * revoke calls with its client secret in the form body; a public app would
 * send a PKCE verifier instead (not built yet). Access tokens last an hour,
 * and a refresh may hand back a new refresh token, which replaces the old.
 */

const REALM = "https://oauth.brevo.com/realms/partner/oauth";
export const BREVO_AUTHORIZE_URL = `${REALM}/authorize`;
export const BREVO_TOKEN_URL = `${REALM}/token`;
export const BREVO_REVOKE_URL = `${REALM}/revoke`;
export const BREVO_USERINFO_URL = `${REALM}/userinfo`;
export const BREVO_ACCOUNT_URL = "https://api.brevo.com/v3/account";

/** What the twenty tools need, and no more: `write` does not imply `read` in
 * Brevo, so both are asked for. A scope outside the app's registered set is
 * refused by Brevo at authorize. */
export const BREVO_SCOPES = [
  "account:read",
  "contacts:read",
  "contacts:write",
  "campaigns.email:read",
  "campaigns.email:write",
  "transactional.email:read",
  "transactional.email:write",
  "offline_access",
  "openid",
  "email",
].join(" ");

/** The app's credentials from the environment, or null when Brevo is not
 * configured, in which case it is not offered and nothing calls Brevo. */
export function brevoClientCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.BREVO_OAUTH_CLIENT_ID;
  const clientSecret = process.env.BREVO_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
