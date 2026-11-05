/**
 * PostHog's OAuth (SCRUM-471): the endpoints, the scopes the connector asks
 * for, the client metadata document, and its connect for the shared flow.
 * The refresh and revoke are in `tokens.ts`.
 *
 * PostHog takes a Client ID Metadata Document: the client id is the URL of a
 * JSON document we serve, there is no client secret and no registration, and
 * every code exchange proves itself with PKCE (S256). One regional host,
 * never `oauth.posthog.com`: that host's proxy remembers a user's region under
 * the client id alone, and a metadata-document client has one id for everyone.
 */
import { envValue } from "@datatorag-mcp/config";
import { cleanWorkspaceName } from "../../untrusted-text";
import type { ConnectorOAuth } from "../../connect/connector-oauth";

/** The hosts a PostHog connection may talk to. The plugin refuses any other,
 * because it is handed the host as where to send the token. */
export const POSTHOG_HOSTS = ["https://us.posthog.com", "https://eu.posthog.com"] as const;
export type PostHogHost = (typeof POSTHOG_HOSTS)[number];
export const DEFAULT_POSTHOG_HOST: PostHogHost = "https://us.posthog.com";

/** The configured host, or the default when it is unset or not one of the
 * two. A value the schema refuses stops the gateway at start; read at call
 * time it still falls back rather than throwing. */
export function posthogHost(): PostHogHost {
  try {
    return envValue("POSTHOG_CONNECTOR_BASE_URL");
  } catch {
    return DEFAULT_POSTHOG_HOST;
  }
}

/** PostHog's paths keep their trailing slashes. */
export function posthogEndpoints(host: string) {
  return {
    authorize: `${host}/oauth/authorize/`,
    token: `${host}/oauth/token/`,
    revoke: `${host}/oauth/revoke/`,
    userinfo: `${host}/oauth/userinfo/`,
    project: (id: number) => `${host}/api/projects/${id}/`,
  };
}

/** What the ten read tools need, and the identity: no write scope at all. */
export const POSTHOG_SCOPE_LIST = [
  "openid",
  "email",
  "project:read",
  "query:read",
  "insight:read",
  "dashboard:read",
  "person:read",
  "error_tracking:read",
] as const;
export const POSTHOG_SCOPES = POSTHOG_SCOPE_LIST.join(" ");

export const POSTHOG_CLIENT_METADATA_PATH = "/auth/posthog/client.json";
export const POSTHOG_CALLBACK_PATH = "/auth/posthog/connect/callback";

/** The client id is the document's own URL, built from the same base as the
 * route that serves it, so the two cannot differ: PostHog requires them equal
 * character for character. */
export function posthogClientId(baseUrl: string): string {
  return `${baseUrl}${POSTHOG_CLIENT_METADATA_PATH}`;
}

/** The document. A production redirect only: a `localhost` entry would let
 * anyone run a flow that shows our name on PostHog's consent screen and lands
 * on their own machine. The `com.posthog` scope ceiling means a hand-built
 * authorize URL is never granted more than the connector asks for. */
export function posthogClientMetadata(baseUrl: string) {
  return {
    client_id: posthogClientId(baseUrl),
    client_name: "DataToRAG",
    client_uri: baseUrl,
    logo_uri: `${baseUrl}/datatorag-logo-256.png`,
    redirect_uris: [`${baseUrl}${POSTHOG_CALLBACK_PATH}`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    "com.posthog": { scopes: [...POSTHOG_SCOPE_LIST] },
  };
}

/** The fields of PostHog's token response the connect reads. */
type PostHogTokenResponse = { posthog_base_url?: unknown; scoped_teams?: unknown };

// One PostHog regional host, a client metadata document for a client id and
// PKCE in place of a secret. One connection is one project: the consent
// screen asks for projects, and a grant of none or several is refused. The
// project id is the account's external id; its name is the label.
export const POSTHOG_CONNECT: ConnectorOAuth = {
  provider: "posthog",
  path: "/auth/posthog/connect",
  nonceCookie: "posthog_connect_nonce",
  // The verifier is the code exchange's only proof, PostHog's client having
  // no secret, so it is httpOnly and scoped to the connect pair's own path.
  pkce: { cookie: "posthog_connect_pkce", cookiePath: "/auth/posthog/connect" },
  scopes: POSTHOG_SCOPES,
  gated: true,
  notOffered: "redirect",
  // No secret: the client id is built from the base URL, which is always set.
  isConfigured: () => true,

  // The document PostHog fetches as our client id. Public, no session: it
  // names nothing but our own URLs. Built from the configured base URL, never
  // the request's host, since PostHog caches it for an hour.
  extraRoutes(router, config) {
    router.get(POSTHOG_CLIENT_METADATA_PATH, (_req, res) => {
      res.set("Cache-Control", "public, max-age=3600");
      res.json(posthogClientMetadata(config.baseUrl));
    });
  },

  authorizeUrl(ctx, nonce, codeChallenge) {
    const url = new URL(posthogEndpoints(posthogHost()).authorize);
    url.searchParams.set("client_id", posthogClientId(ctx.config.baseUrl));
    url.searchParams.set("redirect_uri", ctx.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", POSTHOG_SCOPES);
    url.searchParams.set("state", nonce);
    url.searchParams.set("code_challenge", codeChallenge!);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("required_access_level", "project");
    return url;
  },

  async exchange(code, ctx, codeVerifier) {
    const res = await fetch(posthogEndpoints(posthogHost()).token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: posthogClientId(ctx.config.baseUrl),
        code,
        code_verifier: codeVerifier!,
        redirect_uri: ctx.redirectUri,
      }),
    });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  },

  async identify(tokens) {
    const host = posthogHost();
    const raw = tokens.raw as PostHogTokenResponse;
    // A token is valid only on its own region's host, so one that says it
    // belongs elsewhere is refused, not stored.
    if (raw.posthog_base_url !== undefined && raw.posthog_base_url !== host) return { error: "region_not_allowed" };
    // One connection is one project.
    const teams = raw.scoped_teams;
    if (!Array.isArray(teams) || teams.length !== 1 || !Number.isSafeInteger(teams[0]) || teams[0] <= 0) {
      return { error: "choose_one_project" };
    }
    const projectId = teams[0] as number;

    // The person who authorized, from PostHog's userinfo (openid email), and
    // the project's name for the label.
    const endpoints = posthogEndpoints(host);
    const auth = { Authorization: `Bearer ${tokens.accessToken}` };
    const [userInfoRes, projectRes] = await Promise.all([
      fetch(endpoints.userinfo, { headers: auth }),
      fetch(endpoints.project(projectId), { headers: { ...auth, Accept: "application/json" } }),
    ]);
    if (!userInfoRes.ok) return null;
    const info = (await userInfoRes.json()) as { email?: unknown; email_verified?: unknown };
    if (typeof info.email !== "string" || info.email === "") return null;
    // The label is a nicety: an unreadable project answer leaves it empty.
    let label: string | null = null;
    try {
      if (projectRes.ok) label = cleanWorkspaceName(((await projectRes.json()) as { name?: unknown }).name);
    } catch {
      label = null;
    }
    return {
      email: info.email,
      // Verified only when PostHog says so: a missing claim is not a verified
      // address (OIDC defines the claim).
      emailVerified: info.email_verified === true,
      externalAccountId: String(projectId),
      label,
    };
  },
};
