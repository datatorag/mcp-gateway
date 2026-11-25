import { PUBLIC_CONNECTORS_TEXT } from "@/lib/public-integrations";

/** The docs index's address, `<title>`, and description. Kept beside the page
 * (a page file exports only the page) so a test can hold them to the same
 * rules as every other docs page's. */
export const DOCS_INDEX_PATH = "/docs";
export const DOCS_INDEX_SEARCH_TITLE = "DataToRAG Documentation: MCP Server Setup and Tools";
export const DOCS_INDEX_DESCRIPTION = `Documentation for DataToRAG, an MCP server for ${PUBLIC_CONNECTORS_TEXT}: connect a client, then see what every tool does.`;
