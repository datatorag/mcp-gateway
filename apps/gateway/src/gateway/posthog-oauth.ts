/**
 * PostHog's OAuth (SCRUM-471): the endpoints, the scopes the connector asks
 * for, the client metadata document, and the PKCE pair. Shared by the connect
 * routes (`auth.ts`) and the refresh and revoke in `service-token.ts`, which
 * cannot import each other without a cycle.
 *
 * PostHog takes a Client ID Metadata Document: the client id is the URL of a
 * JSON document we serve, there is no client secret and no registration, and
 * every code exchange proves itself with PKCE (S256). One regional host,
 * never `oauth.posthog.com`: that host's proxy remembers a user's region under
 * the client id alone, and a metadata-document client has one id for everyone.
 */
import { createHash, randomBytes } from "node:crypto";

/** The hosts a PostHog connection may talk to. The plugin refuses any other,
 * because it is handed the host as where to send the token. */
export const POSTHOG_HOSTS = ["https://us.posthog.com", "https://eu.posthog.com"] as const;
export type PostHogHost = (typeof POSTHOG_HOSTS)[number];
export const DEFAULT_POSTHOG_HOST: PostHogHost = "https://us.posthog.com";

/** The configured host, or the default when it is unset or not one of the two. */
export function posthogHost(): PostHogHost {
  const configured = process.env.POSTHOG_CONNECTOR_BASE_URL;
  return (POSTHOG_HOSTS as readonly string[]).includes(configured ?? "") ? (configured as PostHogHost) : DEFAULT_POSTHOG_HOST;
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

/** A PKCE verifier (43 URL-safe characters from 32 random bytes) and its S256
 * challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
