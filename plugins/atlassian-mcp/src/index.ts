import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./create-server.js";
import { AtlassianClient } from "./atlassian-client.js";
import { CONSUME_PATH, handleConsume } from "./internal/consume.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const transports = new Map<string, StreamableHTTPServerTransport>();

const httpServer = createServer(async (req, res) => {
  if (req.url === "/health") {
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Private to the gateway: not an MCP tool, never called by a model. See
  // src/internal/consume.ts.
  if (req.url === CONSUME_PATH) {
    const result = await handleConsume({
      method: req.method,
      headers: req.headers,
      // destroyOnReturn: false, because a refusal stops reading early and
      // the default would tear the socket down before the answer is written.
      body: req.iterator({ destroyOnReturn: false }),
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (result.status === 405) headers.Allow = "POST";
    // A refusal can leave part of the body unread. Close the connection after
    // answering, and discard (never buffer) whatever is still arriving so the
    // caller can finish writing and read the answer.
    if (!req.complete) {
      headers.Connection = "close";
      req.resume();
    }
    res.writeHead(result.status, headers).end(JSON.stringify(result.body));
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

  const userToken = req.headers["x-user-token"] as string | undefined;
  const client = userToken
    ? new AtlassianClient({ accessToken: userToken })
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
  console.error(
    `Atlassian MCP server running on http://localhost:${PORT}/mcp`
  );
});
