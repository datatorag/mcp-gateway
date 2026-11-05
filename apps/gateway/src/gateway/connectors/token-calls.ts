/**
 * Each moved connector's token calls, by connector id: the refresh and the
 * revoke the dispatch maps in `service-token.ts` hand a connection to. Server
 * only. Filled one connector at a time as each moves into its own folder.
 */
import type { Database } from "@datatorag-mcp/db";
import type { ConnectionRef, RefreshOutcome, RevokeTokens } from "../service-token";
import type { ConnectorId } from "./registry";
import { refreshBrevoToken, revokeBrevoGrant } from "./brevo/tokens";
import { refreshSlackToken, revokeSlackGrant } from "./slack/tokens";
import { refreshPostHogToken, revokePostHogGrant } from "./posthog/tokens";
import { refreshNotionToken, revokeNotionGrant } from "./notion/tokens";
import { refreshAtlassianToken } from "./atlassian/tokens";

export interface ConnectorTokenCalls {
  refresh(db: Database, conn: ConnectionRef, refreshToken: string): Promise<RefreshOutcome>;
  /** Absent for a connector whose provider is not told to drop a grant. */
  revoke?(tokens: RevokeTokens): Promise<boolean>;
}

export const CONNECTOR_TOKENS = {
  brevo: { refresh: refreshBrevoToken, revoke: revokeBrevoGrant },
  slack: { refresh: refreshSlackToken, revoke: revokeSlackGrant },
  posthog: { refresh: refreshPostHogToken, revoke: revokePostHogGrant },
  notion: { refresh: refreshNotionToken, revoke: revokeNotionGrant },
  atlassian: { refresh: refreshAtlassianToken },
} satisfies Partial<Record<ConnectorId, ConnectorTokenCalls>>;
