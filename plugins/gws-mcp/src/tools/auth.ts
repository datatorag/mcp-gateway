import { DEFAULT_SERVICES } from "../gws-client.js";
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

export async function handleAuth(
  client: GwsClient,
  _toolName: string,
  args: Record<string, unknown>
) {
  const action = (args.action as string) || "status";

  if (action === "login") {
    const services = (args.services as string) || DEFAULT_SERVICES;
    const authUrl = await client.spawnAuthForUrl(services);

    if (authUrl) {
      return textResponse(
        `Open this URL in your browser to authenticate:\n\n  ${authUrl}\n\nAfter authenticating, try your request again.`
      );
    }
    return textResponse(
      "Authentication login triggered. If a browser window didn't open, check the server logs."
    );
  }

  // Default: status
  const result = await client.authStatus();
  return textResponse(
    result.success
      ? `Authenticated.\n${JSON.stringify(result.data, null, 2)}`
      : "Not authenticated. Use action 'login' to authenticate (extension/stdio mode) or reconnect via MCP OAuth (HTTP mode)."
  );
}
