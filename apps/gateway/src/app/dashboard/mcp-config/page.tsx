import { redirect } from "next/navigation";

/**
 * The MCP config page, retired (SCRUM-487). Home carries the client cards,
 * each client's full steps and the live connection status, so this address
 * only redirects there, for old bookmarks and links.
 *
 * To `/dashboard` with no fragment of its own, on purpose: a browser keeps
 * the fragment of the URL it asked for across a redirect that names none, so
 * an old `/dashboard/mcp-config#cursor` lands on Home with Cursor's steps
 * open. Home checks the session itself.
 */
export default function McpConfigPage() {
  redirect("/dashboard");
}
