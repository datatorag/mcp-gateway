import { Router } from "express";

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata.
 *
 * The MCP endpoint (`/mcp`) is the protected resource. MCP clients that hit it
 * without a valid bearer get a 401 whose `WWW-Authenticate` header points here
 * (see the `/mcp` handler in server.ts); this document tells them which
 * authorization server to run the OAuth flow against. This is a separate
 * document from the authorization-server metadata (RFC 8414,
 * `/.well-known/oauth-authorization-server`) — the AS *is* this same gateway,
 * hence `authorization_servers: [baseUrl]`.
 */
export function createProtectedResourceRouter(baseUrl: string): Router {
  const router = Router();

  router.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
      scopes_supported: ["mcp:tools"],
      bearer_methods_supported: ["header"],
    });
  });

  return router;
}
