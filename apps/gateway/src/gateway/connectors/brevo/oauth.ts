/**
 * Brevo's OAuth (SCRUM-468): its endpoints, the scopes the connector asks
 * for, and its connect for the shared flow.
 *
 * Brevo's partner realm. A private app authenticates the token, refresh and
 * revoke calls with its client secret in the form body; a public app would
 * send a PKCE verifier instead (not built yet). Access tokens last an hour,
 * and a refresh may hand back a new refresh token, which replaces the old.
 * Brevo's scopes are fixed at the app, so there is no consent interstitial.
 * The account is keyed by its email; its company name is the label.
 */
import { credentialsFor } from "../credentials";
import { cleanWorkspaceName } from "../../untrusted-text";
import type { ConnectorOAuth } from "../../connect/connector-oauth";

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
  const { clientId, clientSecret } = credentialsFor("brevo");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const BREVO_CONNECT: ConnectorOAuth = {
  provider: "brevo",
  path: "/auth/brevo/connect",
  nonceCookie: "brevo_connect_nonce",
  scopes: BREVO_SCOPES,
  gated: true,
  notOffered: "redirect",
  isConfigured: (config) => Boolean(config.brevoClientId && config.brevoClientSecret),

  authorizeUrl(ctx, nonce) {
    const url = new URL(BREVO_AUTHORIZE_URL);
    url.searchParams.set("client_id", ctx.config.brevoClientId!);
    url.searchParams.set("redirect_uri", ctx.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", BREVO_SCOPES);
    url.searchParams.set("state", nonce);
    return url;
  },

  async exchange(code, ctx) {
    const res = await fetch(BREVO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: ctx.config.brevoClientId!,
        client_secret: ctx.config.brevoClientSecret!,
        code,
        redirect_uri: ctx.redirectUri,
      }),
    });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  },

  // The person who authorized, from Brevo's userinfo (openid email), and the
  // company the account belongs to, for the label.
  async identify(tokens) {
    const auth = { Authorization: `Bearer ${tokens.accessToken}` };
    const [userInfoRes, accountRes] = await Promise.all([
      fetch(BREVO_USERINFO_URL, { headers: auth }),
      fetch(BREVO_ACCOUNT_URL, { headers: { ...auth, Accept: "application/json" } }),
    ]);
    if (!userInfoRes.ok) return null;
    const info = (await userInfoRes.json()) as { email?: unknown; email_verified?: unknown };
    if (typeof info.email !== "string" || info.email === "") return null;
    // The label is a nicety: an unreadable account answer leaves it empty
    // and the connect goes on.
    let label: string | null = null;
    try {
      if (accountRes.ok) label = cleanWorkspaceName(((await accountRes.json()) as { companyName?: unknown }).companyName);
    } catch {
      label = null;
    }
    return {
      email: info.email,
      // Verified only when Brevo says so: a missing claim is not a verified
      // address (OIDC defines the claim).
      emailVerified: info.email_verified === true,
      externalAccountId: null,
      label,
    };
  },
};
