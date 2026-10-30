/**
 * The /mcp 401 (RFC 9728 §5.1, MCP auth): a Bearer challenge naming the
 * protected-resource metadata, so a client can find the auth server, and a
 * small JSON body. Every MCP client starts OAuth on this 401 when the server
 * is added; nothing about the challenge may change. The body's `message`
 * (SCRUM-466) is for a person reading the raw response: where to sign in and
 * where the setup guide is.
 */
import { signInHref } from "../lib/sign-in";

/** The WWW-Authenticate value. `challengeParams` comes first, as RFC 6750
 * error params (e.g. `error="invalid_token"`). */
export function mcpChallenge(resourceMetadataUrl: string, challengeParams: string[] = []): string {
  return `Bearer ${[...challengeParams, `resource_metadata="${resourceMetadataUrl}"`].join(", ")}`;
}

export function mcpUnauthorizedBody(
  error: string,
  resourceMetadataUrl: string,
  baseUrl: string
): { error: string; resource_metadata: string; message: string } {
  return {
    error,
    resource_metadata: resourceMetadataUrl,
    // Sign-in itself, not the login page, as every call to action (SCRUM-408).
    message: `Sign in at ${baseUrl}${signInHref()}. Setup guide: ${baseUrl}/docs/getting-started.`,
  };
}
