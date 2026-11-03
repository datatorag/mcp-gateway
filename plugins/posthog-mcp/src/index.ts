import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./create-server.js";
import { sessionContext } from "./session-context.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const transports = new Map<string, StreamableHTTPServerTransport>();

const httpServer = createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok" }));
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

  // The token, the regional host and the project, read once per session
  // from the gateway's headers and checked before any call (SCRUM-471).
  const server = createMcpServer(sessionContext(req.headers));

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
  console.error(`PostHog MCP server running on http://localhost:${PORT}/mcp`);
});
