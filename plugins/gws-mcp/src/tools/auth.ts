import { CREATE, ToolDef } from "./annotations.js";
import type { GwsClient } from "../gws-client.js";
import { textResponse } from "./response.js";

export const authTools: ToolDef[] = [
  {
    name: "gws_auth_setup",
    description:
      "Check or manage Google Workspace authentication. In HTTP mode, auth is handled via the MCP OAuth flow. In extension/stdio mode (Claude Desktop), use action 'login' to authenticate or re-authenticate with updated scopes.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "login"],
          description:
            "Action to perform: 'status' (default) checks auth state, 'login' triggers browser-based OAuth login (extension/stdio mode only).",
        },
        services: {
          type: "string",
          description:
            "Comma-separated services to request scopes for (e.g. 'drive,gmail,tasks'). Only used with action 'login'. Defaults to all supported services.",
        },
      },
      required: [],
    },
    annotations: CREATE("Check or change Google authentication"),
  },
];

/**
 * This tool once drove the gws CLI's own login for a desktop install. That
 * install is gone (SCRUM-390): the gateway connects each account and sends
 * its token with every call, so there is nothing here to log in to and no
 * stored login to report on. The tool is still served, unchanged, until its
 * registry row is removed in a change of its own; until then it answers with
 * what is true instead of starting a process.
 */
export async function handleAuth(
  _client: GwsClient,
  _toolName: string,
  args: Record<string, unknown>
) {
  const action = (args.action as string) || "status";
  if (action === "login") {
    return textResponse(
      "This server cannot start a login. Google accounts are connected, and reconnected with new permissions, on the gateway's connections page; after that, try the request again."
    );
  }
  return textResponse(
    "Authentication is handled by the gateway: each call runs as the Google account connected there, and this server holds no login of its own. If a call fails for a missing permission, reconnect the account on the gateway's connections page."
  );
}
