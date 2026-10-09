import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./create-server.js";
import { GwsClient } from "./gws-client.js";
import { FILE_BYTES_PATH, serveFileBytes } from "./internal/file-bytes.js";

const PORT = parseInt(process.env.PORT || "39147", 10);

const transports = new Map<string, StreamableHTTPServerTransport>();

const httpServer = createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Private to the gateway, not an MCP tool: the bytes of a file reference,
  // read with the same per-user token /mcp receives (SCRUM-384).
  if (req.url === FILE_BYTES_PATH) {
    await serveFileBytes(req, res, (accessToken) => new GwsClient({ accessToken }));
    return;
  }

  if (req.url !== "/mcp") {
    res.writeHead(404).end("Not found");
    return;
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId) {
    const existing = transports.get(sessionId);
    if (existing) {
      await existing.handleRequest(req, res);
      return;
    }
    res.writeHead(404).end("Session not found");
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      transports.set(id, transport);
    },
  });

  // If X-User-Token is provided, create a per-session client with that access token
  const userToken = req.headers["x-user-token"] as string | undefined;
  const client = userToken ? new GwsClient({ accessToken: userToken }) : undefined;
  const server = createMcpServer(client);

  transport.onclose = () => {
    if (transport.sessionId) {
      transports.delete(transport.sessionId);
    }
    server.close().catch(() => {});
  };
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

httpServer.listen(PORT, () => {
  console.error(`Google Workspace MCP server running on http://localhost:${PORT}/mcp`);
});
