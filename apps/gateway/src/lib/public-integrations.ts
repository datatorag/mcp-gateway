import { CONNECTORS } from "./docs-connectors";
import { listOf } from "./list-of";
import { MCP_CLIENTS } from "./mcp-clients";

/**
 * The one public list of what DataToRAG connects to, and of the clients it
 * gives steps for, as words for a page. Every marketing surface that names
 * the set reads it from here, so a new public connector or client changes
 * every sentence at once instead of leaving one behind. Brevo, Slack and
 * PostHog are admin-only and are not in it.
 */

/** The eight Google Workspace services, in the order the docs list them. */
const GOOGLE_SERVICES = ["Gmail", "Calendar", "Drive", "Docs", "Sheets", "Slides", "Contacts", "Tasks"] as const;
const ATLASSIAN_SERVICES = ["Jira", "Confluence"] as const;

/** "Google Workspace, Atlassian, and Notion": the public connectors by name. */
export const PUBLIC_CONNECTORS_TEXT = listOf(CONNECTORS.map((c) => c.title));

/** Every public service by name: the Google eight, then Jira, Confluence,
 * and Notion. */
export const PUBLIC_SERVICES_TEXT = `${listOf(GOOGLE_SERVICES)}, plus ${listOf([...ATLASSIAN_SERVICES, "Notion"])}`;

/** The clients the dashboard gives steps for, one name per product family:
 * "Claude, ChatGPT, Codex, and Cursor". */
export const PUBLIC_CLIENTS_TEXT = listOf([
  ...new Set(MCP_CLIENTS.map((c) => (c.group === "claude" ? "Claude" : c.label))),
]);
