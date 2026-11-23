/**
 * The MCP clients we give a connect step for, and the exact config each one
 * takes (SCRUM-482, SCRUM-503).
 *
 * ONE LIST for every surface that hands out a config: the "Add to your agent"
 * block (`components/add-to-agent.tsx`) on the Agent page, the dashboard home,
 * the getting-started docs, and the site pages. Adding a client is one entry
 * here and no component code. The config strings are built here and nowhere
 * else, so what a button copies and what a code block shows can never
 * disagree.
 *
 * Every step and plan note was checked against the client's own docs on the
 * date in `checked`, at the page in `source`. A step is not written from
 * memory: when a client changes its screens, the entry is re-checked and the
 * date moves.
 *
 * The ids are analytics values (`add_to_agent_*` and `copy_mcp_config`
 * carry them), so they never change spelling.
 */

export type ClientId =
  | "claude-web"
  | "claude-desktop"
  | "claude-code"
  | "cursor"
  | "chatgpt"
  | "codex"
  | "other";

/** What the step hands over. `url` is the bare server URL a client's own
 * "add connector" form takes; `command` and `json` are the client's config
 * verbatim, server URL filled in. */
export type ClientPayload = "url" | "command" | "json";

export interface McpClient {
  id: ClientId;
  label: string;
  /** The product family, for a sentence naming the clients we have steps
   * for ("Claude, ChatGPT, Codex, and Cursor"); null for the generic
   * choice. */
  family: string | null;
  /** `/icons/clients/<icon>.svg`; null for the generic choice. */
  icon: "claude" | "chatgpt" | "openai" | "cursor" | null;
  /** One line: where the payload goes. */
  step: string;
  payload: ClientPayload;
  /** One line, only where the client's own docs say a plan or role limits
   * adding a custom connector. */
  planNote?: string;
  /** The client's own page the step was checked against, and when. */
  source: { url: string; checked: string };
  /** The day the client's own add link (`clientDeepLink`) was tried in the
   * real client and worked. Until then the link is offered second, after the
   * copy button: it is built from the client's documented format, not seen
   * working. */
  linkTried?: string;
}

const CHECKED = "2026-11-23";

const CLAUDE_CONNECTORS = {
  url: "https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp",
  checked: CHECKED,
};

const CLAUDE_PLAN_NOTE =
  "The Free plan allows one custom connector. On Team and Enterprise, an owner adds it for the organization.";

export const MCP_CLIENTS: McpClient[] = [
  {
    id: "claude-web",
    family: "Claude",
    label: "Claude",
    icon: "claude",
    step: "In Claude, open Customize, then Connectors, choose Add, then Add custom connector, and paste the URL.",
    payload: "url",
    planNote: CLAUDE_PLAN_NOTE,
    source: CLAUDE_CONNECTORS,
  },
  {
    id: "claude-desktop",
    family: "Claude",
    label: "Claude Desktop",
    icon: "claude",
    step: "In Claude Desktop, open Customize, then Connectors, choose Add, then Add custom connector, and paste the URL.",
    payload: "url",
    planNote: CLAUDE_PLAN_NOTE,
    source: CLAUDE_CONNECTORS,
  },
  {
    id: "claude-code",
    family: "Claude",
    label: "Claude Code",
    icon: "claude",
    step: "Run the command in a terminal, then type /mcp in Claude Code to sign in.",
    payload: "command",
    source: { url: "https://code.claude.com/docs/en/mcp", checked: CHECKED },
  },
  {
    id: "chatgpt",
    family: "ChatGPT",
    label: "ChatGPT",
    icon: "chatgpt",
    step: "In ChatGPT on the web, open Plugins, choose the plus button, then Add custom MCP server, and paste the URL.",
    payload: "url",
    planNote:
      "Needs a Business, Enterprise, or Edu workspace, where an admin may have to allow it. Pro connects with read-only tools.",
    source: { url: "https://help.openai.com/en/articles/12584461", checked: CHECKED },
  },
  {
    id: "codex",
    family: "Codex",
    label: "Codex",
    icon: "openai",
    step: "Run both commands in a terminal: the first adds DataToRAG, the second signs you in.",
    payload: "command",
    source: { url: "https://developers.openai.com/codex/mcp", checked: CHECKED },
  },
  {
    id: "cursor",
    family: "Cursor",
    label: "Cursor",
    icon: "cursor",
    step: "Paste the JSON into your mcp.json, or let Add to Cursor open Cursor with DataToRAG filled in.",
    payload: "json",
    source: { url: "https://cursor.com/docs/context/mcp/install-links", checked: CHECKED },
  },
  {
    id: "other",
    family: null,
    label: "Other MCP client",
    icon: null,
    step: "Add this address as a remote MCP server in any client that supports sign-in with OAuth.",
    payload: "url",
    source: { url: "https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization", checked: CHECKED },
  },
];

/** The server's name in every client config. */
export const SERVER_NAME = "datatorag";

/** What the step's copy button copies for this client, with the user's
 * server URL. */
export function clientConfig(id: ClientId, mcpUrl: string): string {
  switch (id) {
    case "claude-web":
    case "claude-desktop":
    case "chatgpt":
    case "other":
      return mcpUrl;
    case "claude-code":
      return `claude mcp add --transport http ${SERVER_NAME} ${mcpUrl}`;
    case "codex":
      return `codex mcp add ${SERVER_NAME} --url ${mcpUrl}\ncodex mcp login ${SERVER_NAME}`;
    case "cursor":
      return genericJson(mcpUrl);
  }
}

/** The config most clients take in a file: the shape Cursor documents, and
 * the one the generic choice shows beside the address. */
export function genericJson(mcpUrl: string): string {
  return `{
  "mcpServers": {
    "${SERVER_NAME}": {
      "url": "${mcpUrl}"
    }
  }
}`;
}

/** The client's own link that opens its add screen with our server filled
 * in, for the clients that document one. Cursor's takes the single server
 * object (no name key), JSON then base64. */
export function clientDeepLink(id: ClientId, mcpUrl: string): string | null {
  if (id === "cursor") {
    const config = btoa(JSON.stringify({ url: mcpUrl }));
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(config)}`;
  }
  return null;
}

/** The label on the copy button, by what it copies. */
export function copyLabel(payload: ClientPayload): string {
  return payload === "url" ? "Copy URL" : payload === "command" ? "Copy command" : "Copy JSON";
}

export function isClientId(value: string): value is ClientId {
  return MCP_CLIENTS.some((c) => c.id === value);
}

export function clientById(id: ClientId): McpClient {
  return MCP_CLIENTS.find((c) => c.id === id) ?? MCP_CLIENTS[0];
}

/**
 * Which of our clients an OAuth client's registered name is, for the
 * connected mark. The name is the client's own claim at registration, so
 * this reads it loosely and answers nothing when there is no name. Seen in
 * production: "Claude", "Claude Code (<server label>)", "Cursor". ChatGPT and
 * Codex had not registered by 2026-11-23, so theirs are a guess at the
 * product name; any other name marks "Other MCP client". Claude on the
 * web and Claude Desktop register under the same name, so a Claude
 * connection marks both.
 */
export function clientIdsForRegisteredName(name: string | null | undefined): ClientId[] {
  const n = (name ?? "").toLowerCase();
  if (!n) return [];
  if (n.includes("claude code")) return ["claude-code"];
  if (n.includes("claude")) return ["claude-web", "claude-desktop"];
  if (n.includes("cursor")) return ["cursor"];
  if (n.includes("codex")) return ["codex"];
  if (n.includes("chatgpt") || n.includes("openai")) return ["chatgpt"];
  return ["other"];
}

/** The production URL, the seed for anything rendered before the browser can
 * say which origin it is on (prerendered docs). */
export const DEFAULT_MCP_URL = "https://datatorag.com/mcp";
