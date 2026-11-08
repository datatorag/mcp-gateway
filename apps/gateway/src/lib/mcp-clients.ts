/**
 * The MCP clients we give install steps for, and the exact config each one
 * takes (SCRUM-482).
 *
 * ONE LIST for every surface that hands out a config: the dashboard home's
 * client cards, the `/dashboard/mcp-config` detail view and the getting-started
 * docs (both through `SetupInstructions`). The config strings are built here
 * and nowhere else, so a card's Copy and the detail view's code block can
 * never disagree about what to paste.
 *
 * The ids are analytics values (`copy_mcp_config` sources read
 * `wizard_<id>`, `docs_<id>`, `home_<id>`), so they never change spelling.
 */

export type ClientId =
  | "claude-web"
  | "claude-desktop"
  | "claude-code"
  | "chatgpt"
  | "codex"
  | "cursor";

export type ClientGroup = "claude" | "openai" | "cursor";

/** What a card's one action hands over. `url` is the bare server URL a
 * client's own "add connector" form takes; `command` and `json` are the
 * client's config verbatim, server URL filled in. */
export type ClientPayload = "url" | "command" | "json";

export interface McpClient {
  id: ClientId;
  label: string;
  group: ClientGroup;
  /** `/icons/clients/<icon>.svg`. */
  icon: "claude" | "chatgpt" | "openai" | "cursor";
  /** One line, what to do with the payload. */
  step: string;
  payload: ClientPayload;
}

export const CLIENT_GROUPS: { id: ClientGroup; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "openai", label: "ChatGPT and Codex" },
  { id: "cursor", label: "Cursor" },
];

export const MCP_CLIENTS: McpClient[] = [
  {
    id: "claude-web",
    label: "Claude.ai",
    group: "claude",
    icon: "claude",
    step: "Customize, Connectors, Add custom connector, then paste the URL.",
    payload: "url",
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    group: "claude",
    icon: "claude",
    step: "Customize, Connectors, Add custom connector, then paste the URL.",
    payload: "url",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    group: "claude",
    icon: "claude",
    step: "Run the command in your terminal, then sign in when asked.",
    payload: "command",
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    group: "openai",
    icon: "chatgpt",
    step: "Settings, Connectors, turn on Developer mode, Create, then paste the URL.",
    payload: "url",
  },
  {
    id: "codex",
    label: "Codex",
    group: "openai",
    icon: "openai",
    step: "Run both commands in your terminal: the first adds the server, the second signs in.",
    payload: "command",
  },
  {
    id: "cursor",
    label: "Cursor",
    group: "cursor",
    icon: "cursor",
    step: "Install opens Cursor with DataToRAG filled in. Or copy the JSON into your MCP config.",
    payload: "json",
  },
];

/** The server's name in every client config. */
export const SERVER_NAME = "datatorag";

/** What a card copies for this client, with the user's server URL. */
export function clientConfig(id: ClientId, mcpUrl: string): string {
  switch (id) {
    case "claude-web":
    case "claude-desktop":
    case "chatgpt":
      return mcpUrl;
    case "claude-code":
      return `claude mcp add --transport http ${SERVER_NAME} ${mcpUrl}`;
    case "codex":
      return `codex mcp add ${SERVER_NAME} --url ${mcpUrl}\ncodex mcp login ${SERVER_NAME}`;
    case "cursor":
      return `{
  "mcpServers": {
    "${SERVER_NAME}": {
      "url": "${mcpUrl}"
    }
  }
}`;
  }
}

/** The client's own install link, for the clients that have one. Cursor's
 * takes the single server object (no name key), JSON then base64. */
export function clientDeepLink(id: ClientId, mcpUrl: string): string | null {
  if (id === "cursor") {
    const config = btoa(JSON.stringify({ url: mcpUrl }));
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(config)}`;
  }
  return null;
}

/** The detail view's anchor for one client: `SetupInstructions` opens the
 * client named by the hash. */
export function clientDetailHref(id: ClientId): string {
  return `/dashboard/mcp-config#${id}`;
}

export function isClientId(value: string): value is ClientId {
  return MCP_CLIENTS.some((c) => c.id === value);
}

/** The production URL, the seed for anything rendered before the browser can
 * say which origin it is on (prerendered docs). */
export const DEFAULT_MCP_URL = "https://datatorag.com/mcp";
