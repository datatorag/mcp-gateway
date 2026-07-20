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
/**
 * The discovery path advertised in `WWW-Authenticate: Bearer
 * resource_metadata="…"` on /mcp 401s (server.ts) — exported so the 401
 * handler and this router can never point at different paths.
 */
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

export function createProtectedResourceRouter(baseUrl: string): Router {
  const router = Router();

  router.get(PROTECTED_RESOURCE_PATH, (_req, res) => {
    res.json({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
      scopes_supported: ["mcp:tools"],
      bearer_methods_supported: ["header"],
    });
  });

  return router;
}
