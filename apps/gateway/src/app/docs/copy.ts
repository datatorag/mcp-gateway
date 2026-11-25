import { PUBLIC_CLIENTS_TEXT, PUBLIC_CONNECTORS_TEXT } from "@/lib/public-integrations";

/** The docs index's address, `<title>`, and description. Kept beside the page
 * (a page file exports only the page) so a test can hold them to the same
 * rules as every other docs page's. */
export const DOCS_INDEX_PATH = "/docs";
export const DOCS_INDEX_SEARCH_TITLE = "DataToRAG Documentation: MCP Server Setup and Tools";
export const DOCS_INDEX_DESCRIPTION = `Documentation for DataToRAG, an MCP server for ${PUBLIC_CONNECTORS_TEXT}: connect a client, then see what every tool does.`;

/**
 * The docs' vocabulary: one name for each thing, used on every docs page.
 * The index renders it as its glossary, each term under its `id`, so a page
 * can link a term. An id is an address: change a term's words, never its id.
 * A new docs page uses these words and no synonym ("gateway", "connector"
 * for a service's tools, "AI agent", "app" for a client).
 */
export const DOCS_GLOSSARY_HEADING = "Words these docs use";
export const DOCS_GLOSSARY: ReadonlyArray<{ id: string; term: string; definition: string }> = [
  {
    id: "term-datatorag",
    term: "DataToRAG",
    definition: `The product: an MCP server and a dashboard that give an agent tools for ${PUBLIC_CONNECTORS_TEXT}.`,
  },
  {
    id: "term-datatorag-mcp-server",
    term: "DataToRAG MCP server",
    definition:
      "The server your client connects to, at https://datatorag.com/mcp. It is what you add to a client. Claude's settings call an added server a custom connector; these docs call it the DataToRAG MCP server in every client.",
  },
  {
    id: "term-client",
    term: "Client",
    definition: `The program you add the DataToRAG MCP server to and talk to your agent in, such as ${PUBLIC_CLIENTS_TEXT.replace(", and ", ", or ")}.`,
  },
  {
    id: "term-agent",
    term: "Agent",
    definition: "The model working in your client. It reads what you ask and calls the tools.",
  },
  {
    id: "term-dashboard-agent",
    term: "Dashboard Agent",
    definition:
      "The chat on the Agent page of the DataToRAG dashboard. It runs the same tools against your connected accounts, with no client to set up.",
  },
  {
    id: "term-provider",
    term: "Provider",
    definition: "A company whose accounts you connect to DataToRAG: Google, Atlassian, or Notion.",
  },
  {
    id: "term-service",
    term: "Service",
    definition:
      "One product of a provider, such as Gmail, Google Sheets, Jira, or Confluence. Its tools are named for it: the Gmail tools, the Jira tools.",
  },
  {
    id: "term-connected-account",
    term: "Connected account",
    definition:
      "An account at a provider that you have connected to DataToRAG, on the Connections page of the dashboard or from a connect link. You can connect several for one provider, and one of them is the default.",
  },
  {
    id: "term-built-in-tool",
    term: "Built-in tool",
    definition:
      "A tool the DataToRAG MCP server answers itself, such as connect and list_connected_accounts. Every other tool belongs to a service.",
  },
];

/** The docs index's visible heading, shared by the page and its Markdown copy. */
export const DOCS_INDEX_HEADING = "DataToRAG documentation";
