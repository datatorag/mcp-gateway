import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Database } from "@datatorag-mcp/db";
import { oauthClients } from "@datatorag-mcp/db";
import { checkRedirectUris } from "./redirect-uri-rules";
import { cleanRegisteredClientName } from "../untrusted-text";

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

    // SCRUM-373: the code goes wherever the client registered, so what may
    // be registered is the rule (redirect-uri-rules.ts). RFC 7591 names the
    // error.
    const checked = checkRedirectUris(redirect_uris);
    if (!checked.ok) {
      res.status(400).json({
        error: "invalid_redirect_uri",
        error_description: checked.description,
      });
      return;
    }
    // Shown on the consent page, so stored cleaned and capped.
    const clientName = cleanRegisteredClientName(client_name);

    const clientId = randomUUID();

    // Public clients only: we never issue or verify a client secret, so every
    // registration is "none" regardless of what was requested (PKCE is the
    // protection). The response echoes the true registered method so a client
    // requesting client_secret_post learns it was registered public.
    const tokenEndpointAuthMethod = "none";

    await db.insert(oauthClients).values({
      clientId,
      redirectUris: checked.uris,
      clientName,
      grantTypes: grant_types,
      responseTypes: response_types,
      tokenEndpointAuthMethod,
    });

    res.status(201).json({
      client_id: clientId,
      redirect_uris: checked.uris,
      client_name: clientName,
      grant_types,
      response_types,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
    });
  });

  return router;
}
