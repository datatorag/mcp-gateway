import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./create-server.js";
import { NotionClient } from "./notion-client.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const transports = new Map<string, StreamableHTTPServerTransport>();

const httpServer = createServer(async (req, res) => {
  if (req.url === "/health") {
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ status: "ok" }));
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

  // One user's Notion access token per session, from the gateway. Without
  // one the session's calls are refused in words by the client.
  const userToken = req.headers["x-user-token"] as string | undefined;
  const client = userToken
    ? new NotionClient({ accessToken: userToken })
    : undefined;
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
  console.error(`Notion MCP server running on http://localhost:${PORT}/mcp`);
});
