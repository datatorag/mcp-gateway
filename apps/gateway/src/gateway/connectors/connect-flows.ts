/**
 * Each moved connector's connect, by connector id, for the shared flow
 * (`connect/mount-connect-flow.ts`). Server only, and kept apart from the
 * token calls so the connect routes load nothing from `service-token.ts`.
 * One entry per connector: a connector added to the registry without its
 * connect fails to compile.
 */
import type { ConnectorOAuth } from "../connect/connector-oauth";
import type { ConnectorId } from "./registry";
import { BREVO_CONNECT } from "./brevo/oauth";
import { SLACK_CONNECT } from "./slack/oauth";
import { POSTHOG_CONNECT } from "./posthog/oauth";
import { NOTION_CONNECT } from "./notion/oauth";
import { ATLASSIAN_CONNECT } from "./atlassian/oauth";
import { GOOGLE_CONNECT } from "./google/oauth";

export const CONNECTOR_OAUTH = {
  brevo: BREVO_CONNECT,
  slack: SLACK_CONNECT,
  posthog: POSTHOG_CONNECT,
  notion: NOTION_CONNECT,
  atlassian: ATLASSIAN_CONNECT,
  "google-workspace": GOOGLE_CONNECT,
} satisfies Record<ConnectorId, ConnectorOAuth>;
