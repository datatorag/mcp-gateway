import { connectorCredentials } from "@datatorag-mcp/config";
import { CONNECTOR_REGISTRY, type CredentialedConnectorId } from "./registry";

/**
 * A connector's OAuth client credentials, by its registry id, read when they
 * are needed through the config schema (empty strings when unset). Server
 * only: the registry itself stays free of anything that reads the
 * environment, because the browser bundle imports it.
 */
export function credentialsFor(id: CredentialedConnectorId): { clientId: string; clientSecret: string } {
  const prefix = CONNECTOR_REGISTRY.find((c) => c.id === id)?.envPrefix;
  if (!prefix) throw new Error(`no client credentials are declared for ${id}`);
  return connectorCredentials(prefix);
}
