import { Router } from "express";

/**
 * RFC 9728 — OAuth Authorization Server Metadata
 * MCP clients discover auth endpoints via this well-known URL.
 */
export function createMetadataRouter(baseUrl: string): Router {
  const router = Router();

  router.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      registration_endpoint: `${baseUrl}/oauth/register`,
      revocation_endpoint: `${baseUrl}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      // Public clients only — MCP clients (Claude Desktop, Cursor, etc.) can't
      // safely hold a secret, so PKCE (S256, required) is the protection, not
      // client authentication. We only advertise what we actually enforce.
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp:tools"],
    });
  });

  return router;
}
