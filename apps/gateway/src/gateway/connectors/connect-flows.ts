/**
 * Each moved connector's connect, by connector id, for the shared flow
 * (`connect/mount-connect-flow.ts`). Server only, and kept apart from the
 * token calls so the connect routes load nothing from `service-token.ts`.
 * Filled one connector at a time as each moves into its own folder.
 */
import type { ConnectorOAuth } from "../connect/connector-oauth";
import type { ConnectorId } from "./registry";
import { BREVO_CONNECT } from "./brevo/oauth";
import { SLACK_CONNECT } from "./slack/oauth";
import { POSTHOG_CONNECT } from "./posthog/oauth";
import { NOTION_CONNECT } from "./notion/oauth";

export const CONNECTOR_OAUTH = {
  brevo: BREVO_CONNECT,
  slack: SLACK_CONNECT,
  posthog: POSTHOG_CONNECT,
  notion: NOTION_CONNECT,
} satisfies Partial<Record<ConnectorId, ConnectorOAuth>>;
