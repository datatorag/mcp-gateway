/**
 * The dashboard home's words (SCRUM-482), in one list so the review is one
 * read and `home-copy.test.ts` can hold the mechanical rules (no em-dashes).
 */

export const HOME_HEADLINE =
  "Use your Google Workspace, Atlassian and Notion from the assistant you already use";
export const HOME_STANDFIRST =
  "Add DataToRAG to Claude, ChatGPT, Codex or Cursor, connect an account, then ask.";
export const HOME_CTA = "Connect my agent";

export const HOME_PROMPTS_HEADING = "Things to ask";
/** The disabled prompt card's title, unchanged from before the home moved. */
export const PROMPT_CARD_LOCKED_TITLE = "Connect an account to run this";

export const HOME_CLIENTS_HEADING = "Connect your agent";
export const HOME_CLIENTS_STANDFIRST =
  "Pick the client you use. It asks you to sign in to DataToRAG the first time it connects.";
export const HOME_CONNECT_FIRST_NOTE =
  "Connect at least one account before your agent's first call, or it has nothing to work with.";

export const HOME_MCP_HEADING = "Your MCP server";

export const HOME_STATUS_HEADING = "Your accounts";

export type ServiceStatus = "connected" | "not_connected" | "needs_reconnect";

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  connected: "Connected",
  not_connected: "Not connected",
  needs_reconnect: "Needs reconnecting",
};
