/**
 * A fake vendor MCP server for tests (official-mcp-proxy): the SDK's own
 * server over real HTTP, stateless, at `/mcp`. Each request's headers and
 * path are recorded, so a test can see exactly what reached the vendor.
 * `routes` adds plain HTTP answers beside it (a 401, a 429, an HTML page).
 */
import { createServer, type IncomingHttpHeaders } from "node:http";
import express, { type Express } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export type FakeVendor = {
  base: string;
  /** Headers of every request that reached `/mcp`. */
  seen: IncomingHttpHeaders[];
  /** Paths, with query, of every request that reached `/mcp`. */
  seenUrls: string[];
  close(): Promise<void>;
};

export async function startFakeVendor(register: (mcp: McpServer) => void, routes?: (app: Express) => void): Promise<FakeVendor> {
  const seen: IncomingHttpHeaders[] = [];
  const seenUrls: string[] = [];
  const app = express();
  app.use(express.json());
  app.post("/mcp", async (req, res) => {
    seen.push(req.headers);
    seenUrls.push(req.originalUrl);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const mcp = new McpServer({ name: "fake-vendor", version: "1.0.0" });
    register(mcp);
    res.on("close", () => void transport.close());
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  routes?.(app);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("no port");
  return {
    base: `http://127.0.0.1:${addr.port}`,
    seen,
    seenUrls,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
