import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/**
 * The plugin server our tests run against — one implementation, shared by every
 * suite that needs a real MCP server on the other end of the wire.
 *
 * IT BINDS IDENTITY AT SESSION CREATION, and that is the entire point of it.
 * Our real plugin servers keep a map of session id → transport: the very first
 * request of a session creates the transport and reads `X-User-Token` off THAT
 * request to build the upstream API client, and every later request is routed
 * to the existing transport by its `mcp-session-id` header alone. The token
 * header on those later requests is never looked at again.
 *
 * The fakes this replaces were stateless — a fresh server per HTTP request,
 * reading the token off each one. That is a friendlier server than we actually
 * run, and a friendlier server cannot fail the way the real one does: a client
 * that opens ONE session and then sends per-call tokens looks perfectly correct
 * against a stateless fake and is, against a real plugin, either unauthenticated
 * or acting as whoever happened to open the session. So the fake models the
 * hostile detail on purpose.
 *
 * Consequences a test author should expect:
 * - The token that matters is the one present on the INITIALIZE request.
 * - Every tool result is attributed to the session's bound identity, so a test
 *   can assert on who the server thought it was acting as rather than on our
 *   own bookkeeping.
 * - One MCP client that serves two users will show up here as ONE session, with
 *   both users' calls attributed to the same identity.
 */

/** Header the plugin servers read to decide whose credentials to act with.
 * Lower-cased because that is how Node presents it on `req.headers`. */
const USER_TOKEN_HEADER = "x-user-token";

export type FakePluginTool = {
  name: string;
  /** MCP tool annotations, verbatim. Used by the write-gate suite to serve a
   * mutating tool that claims to be read-only. */
  annotations?: Record<string, unknown>;
};

/** One session, as the server sees it: the id it minted and the identity it
 * bound at initialize. */
export type FakePluginSession = {
  id: string;
  token: string | undefined;
};

/** One tool call, with the identity the SERVER attributed it to. `token` is the
 * session's bound token, NOT whatever header rode along with this request —
 * modelling the real server, which cannot see the latter. */
export type FakePluginCall = {
  tool: string;
  args: Record<string, unknown>;
  token: string | undefined;
  sessionId: string | undefined;
};

export type FakePlugin = {
  port: number;
  url: string;
  /** Every call, with the session identity the server attributed it to. */
  calls: FakePluginCall[];
  /** The same calls, tool and arguments only. THE audit signal for the write
   * gate: an entry here means the call genuinely reached the server. */
  executed: Array<{ tool: string; args: Record<string, unknown> }>;
  /** Sessions in the order they were opened, each with the token it was bound
   * to. A test that cares about identity isolation asserts on this. */
  sessions: FakePluginSession[];
  close: () => Promise<void>;
};

/** The union of every argument shape the suites exercise. One schema rather
 * than a per-tool one keeps the fake a fake: `account` has to be declared or
 * the account-strip assertion could not tell "stripped" from "rejected". */
const INPUT_SCHEMA = {
  title: z.string().optional(),
  note: z.string().optional(),
  account: z.string().optional(),
};

function normalize(tool: string | FakePluginTool): FakePluginTool {
  return typeof tool === "string" ? { name: tool } : tool;
}

/**
 * Starts a plugin server on an ephemeral port.
 *
 * @param tools Tool names, or `{ name, annotations }` for tools that need MCP
 * annotations.
 */
export async function startFakePlugin(
  tools: Array<string | FakePluginTool>
): Promise<FakePlugin> {
  const pluginTools = tools.map(normalize);
  const calls: FakePluginCall[] = [];
  const executed: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const sessions: FakePluginSession[] = [];
  const transports = new Map<string, StreamableHTTPServerTransport>();

  /** Opens a session: reads the token off THIS request, once, and builds a
   * server whose tool handlers close over it. Nothing later can change it. */
  async function openSession(
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown
  ): Promise<void> {
    const header = req.headers[USER_TOKEN_HEADER];
    const boundToken = Array.isArray(header) ? header[0] : header;
    // Mutable only so the handlers can report the session id, which the
    // transport does not mint until the initialize response is written.
    const session: FakePluginSession = { id: "", token: boundToken };

    const server = new McpServer({ name: "fake-plugin", version: "1.0.0" });
    for (const pluginTool of pluginTools) {
      server.registerTool(
        pluginTool.name,
        {
          description: pluginTool.name,
          inputSchema: INPUT_SCHEMA,
          ...(pluginTool.annotations
            ? { annotations: pluginTool.annotations as never }
            : {}),
        },
        async (args) => {
          const recorded = args as Record<string, unknown>;
          calls.push({
            tool: pluginTool.name,
            args: recorded,
            token: session.token,
            sessionId: session.id,
          });
          executed.push({ tool: pluginTool.name, args: recorded });
          // The result names the identity the SESSION was bound to, so a test
          // can read attribution out of the model-visible output — the same
          // place a user would notice it going wrong.
          return {
            content: [
              {
                type: "text" as const,
                text: `executed ${pluginTool.name} as ${session.token ?? "anonymous"}`,
              },
            ],
          };
        }
      );
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // JSON rather than SSE for the response body. That is a transport
      // encoding detail and is deliberately the ONE way this differs from the
      // deployed plugins: it keeps the tests free of long-lived streams to reap,
      // and identity binding — the thing under test — is untouched by it.
      enableJsonResponse: true,
      onsessioninitialized: (id: string) => {
        session.id = id;
        transports.set(id, transport);
        sessions.push({ id, token: boundToken });
      },
    });
    // Guarded because `server.close()` closes the transport, which fires
    // `onclose` again — an unguarded handler recurses until the stack goes.
    let closed = false;
    transport.onclose = () => {
      if (closed) return;
      closed = true;
      if (transport.sessionId) transports.delete(transport.sessionId);
      void server.close().catch(() => {});
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  const http: Server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw.length > 0 ? JSON.parse(raw) : undefined;

      const sessionHeader = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;

      // An established session is routed by its id and NOTHING else. Any
      // `X-User-Token` on this request is ignored, exactly as the real server
      // ignores it.
      if (sessionId) {
        const existing = transports.get(sessionId);
        if (existing) {
          await existing.handleRequest(req, res, body);
          return;
        }
        res.writeHead(404).end("Session not found");
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      await openSession(req, res, body);
    })();
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as AddressInfo).port;

  return {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    executed,
    sessions,
    close: () =>
      new Promise<void>((resolve) => {
        for (const transport of transports.values()) void transport.close();
        transports.clear();
        http.closeAllConnections?.();
        http.close(() => resolve());
      }),
  };
}

/** A registry row shaped the way the plugin registry stores one. `githubRepoUrl`
 * set means "runs on localhost at containerPort", which is what a fake plugin on
 * an ephemeral port is. */
export function fakePluginServerRow(slug: string, port: number) {
  return {
    slug,
    containerPort: port,
    githubRepoUrl: `https://github.com/datatorag/${slug}`,
  };
}
