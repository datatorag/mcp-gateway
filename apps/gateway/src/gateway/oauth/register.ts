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
      token_endpoint_auth_method = "none",
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

    await db.insert(oauthClients).values({
      clientId,
      redirectUris: redirect_uris,
      clientName: client_name ?? null,
      grantTypes: grant_types,
      responseTypes: response_types,
      tokenEndpointAuthMethod: token_endpoint_auth_method,
    });

    res.status(201).json({
      client_id: clientId,
      redirect_uris,
      client_name: client_name ?? null,
      grant_types,
      response_types,
      token_endpoint_auth_method,
    });
  });

  return router;
}
