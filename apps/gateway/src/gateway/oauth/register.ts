import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@datatorag-mcp/db";
import { oauthClients } from "@datatorag-mcp/db";

/**
 * RFC 7591 — Dynamic Client Registration
 * MCP clients register themselves before starting the OAuth flow.
 */
export function createRegisterRouter(db: Database): Router {
  const router = Router();

  router.post("/oauth/register", async (req, res) => {
    const {
      redirect_uris,
      client_name,
      grant_types = ["authorization_code", "refresh_token"],
      response_types = ["code"],
    } = req.body ?? {};

    if (
      !redirect_uris ||
      !Array.isArray(redirect_uris) ||
      redirect_uris.length === 0
    ) {
      res.status(400).json({
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required",
      });
      return;
    }

    const clientId = randomUUID();

    // Public clients only: we never issue or verify a client secret, so every
    // registration is "none" regardless of what was requested (PKCE is the
    // protection). The response echoes the true registered method so a client
    // requesting client_secret_post learns it was registered public.
    const tokenEndpointAuthMethod = "none";

    await db.insert(oauthClients).values({
      clientId,
      redirectUris: redirect_uris,
      clientName: client_name ?? null,
      grantTypes: grant_types,
      responseTypes: response_types,
      tokenEndpointAuthMethod,
    });

    res.status(201).json({
      client_id: clientId,
      redirect_uris,
      client_name: client_name ?? null,
      grant_types,
      response_types,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
    });
  });

  return router;
}
