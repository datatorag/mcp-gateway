import { spawn } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer, gwsClient } from "./create-server.js";
import {
  DEFAULT_SERVICES,
  REQUIRED_SCOPE_KEYWORDS,
  errorMessage,
} from "./gws-client.js";

// Catch any uncaught errors so they appear in Claude Desktop logs
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

function openAuthUrl(url: string) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", url], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "linux") {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

async function triggerReAuth(reason: string) {
  console.error(`Re-authenticating: ${reason}`);
  // Clear old credentials first to guarantee a fresh token with all scopes
  await gwsClient.logout();

  const authUrl = await gwsClient.spawnAuthForUrl(DEFAULT_SERVICES);
  if (authUrl) openAuthUrl(authUrl);
}

// Start MCP server immediately so Claude Desktop doesn't time out
console.error("Extension starting...");
const server = createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Extension connected.");

// Then check auth in background and open browser if needed
gwsClient.authStatus().then((status) => {
  const data = status.data as Record<string, unknown> | null;

  // Case 1: No credentials at all
  if (!status.success || data?.auth_method === "none" || data?.storage === "none") {
    triggerReAuth("no credentials found");
    return;
  }

  // Case 2: Credentials exist but scopes are missing
  const scopes = data?.scopes as string[] | undefined;
  if (scopes) {
    const missing = REQUIRED_SCOPE_KEYWORDS.filter(
      (keyword) => !scopes.some((s) => s.includes(keyword))
    );
    if (missing.length > 0) {
      triggerReAuth(`missing scopes: ${missing.join(", ")}`);
    }
  }
}).catch((err) => {
  console.error("Auth status check failed:", errorMessage(err));
});
