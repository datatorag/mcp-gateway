/**
 * Each moved connector's token calls, by connector id: the refresh and the
 * revoke the dispatch maps in `service-token.ts` hand a connection to. Server
 * only. Filled one connector at a time as each moves into its own folder.
 */
import type { Database } from "@datatorag-mcp/db";
import type { ConnectionRef, RefreshOutcome, RevokeTokens } from "../service-token";
import type { ConnectorId } from "./registry";
import { refreshBrevoToken, revokeBrevoGrant } from "./brevo/tokens";

export interface ConnectorTokenCalls {
  refresh(db: Database, conn: ConnectionRef, refreshToken: string): Promise<RefreshOutcome>;
  revoke(tokens: RevokeTokens): Promise<boolean>;
}

export const CONNECTOR_TOKENS = {
  brevo: { refresh: refreshBrevoToken, revoke: revokeBrevoGrant },
} satisfies Partial<Record<ConnectorId, ConnectorTokenCalls>>;
