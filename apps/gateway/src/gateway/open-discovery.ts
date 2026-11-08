/**
 * Discovery before sign-in on /mcp (SCRUM-481).
 *
 * The MCP spec lets a server answer `initialize` and `tools/list` before
 * authorization while tool calls stay behind it. Agents and directories read
 * the tool list before anyone signs up, so a request with NO bearer whose one
 * JSON-RPC message is a discovery method is answered here; everything else
 * keeps the 401 and its challenge, so a client still finds the auth flow.
 *
 * What is open is the list below and nothing else. A request with a bearer
 * that fails (expired, revoked, unknown) is not discovery: it keeps the
 * `invalid_token` 401, so a client refreshes instead of carrying on unsigned.
 *
 * Nothing here knows a user. The tools are the public registry snapshot
 * (`listPublicToolRows`, shaped by the same `listedTools` a session uses), the
 * prompts are the published skills, and the instructions name the public
 * providers. Each request gets a stateless server and transport: no session
 * id is issued, nothing is kept after the response, and there is no
 * tools/call handler to reach, so nothing is metered or written to usage.
 *
 * Abuse: per-IP limits (`DISCOVERY_LIMITS`), keyed like the OAuth limiter on
 * the Cloudflare client IP. A browser Origin other than ours or a loopback
 * one is refused with a 403, as the transport spec asks of every server.
 */
import type { Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ErrorCode, ListPromptsRequestSchema, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { createRateLimiter, type RateLimiter } from "./usage/rate-limit";
import { requestClientIp } from "./client-ip";
import { discoveryKeys } from "./auth-failure-context";
import { extractClientInfo, type McpDiscovery } from "./mcp-analytics";
import { cleanClientName, cleanUserAgent } from "./untrusted-text";
import type { ListedTool } from "./mcp-server";

/** The methods answered without a bearer. `notifications/initialized` is
 * the handshake's second half (a client that is refused it stops before
 * tools/list); `ping` is what a directory sends to see the server is up.
 * `resources/list` is not here because the server serves no resources. */
export const OPEN_DISCOVERY_METHODS: readonly string[] = [
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "prompts/list",
];

/** Per client IP. A discovery is three or four requests (initialize, the
 * initialized notification, tools/list, maybe prompts/list), so a minute
 * holds several full discoveries from one address and an hour holds a
 * directory's daily probe many times over. */
export const DISCOVERY_LIMITS = { perMinute: 30, perHour: 300 } as const;

/** The open method a request body is, or null. One JSON-RPC message only: a
 * batch is not discovery, even if every message in it would be. */
export function openDiscoveryMethod(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { jsonrpc, method } = body as { jsonrpc?: unknown; method?: unknown };
  if (jsonrpc !== "2.0" || typeof method !== "string") return null;
  return OPEN_DISCOVERY_METHODS.includes(method) ? method : null;
}

/** The open method of a request that carries no bearer, or null: a POST
 * whose body is one open message. A GET (the event stream) or DELETE is
 * never discovery. */
export function openDiscoveryRequest(req: Pick<Request, "method" | "body">): string | null {
  return req.method === "POST" ? openDiscoveryMethod(req.body) : null;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether a request's Origin may use the open methods. Absent (every
 * non-browser client), ours, or a loopback page (a local inspector) are
 * allowed; any other browser origin is refused, which is the transport
 * spec's DNS-rebinding rule. There is no credential on these methods, so
 * this is that rule, not a CSRF control.
 */
export function discoveryOriginAllowed(origin: string | undefined, baseUrl: string): boolean {
  if (origin === undefined) return true;
  if (origin === new URL(baseUrl).origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.has(url.hostname);
}

export type OpenDiscoveryDeps = {
  baseUrl: string;
  /** The leads salt: the discovery id and peer hash are null without it. */
  salt: string;
  serverSha: string;
  /** The open tool list: public registry snapshot plus public built-ins. */
  listTools: () => Promise<ListedTool[]>;
  listPrompts: () => Promise<unknown[]>;
  instructions: () => Promise<string>;
  serverInfo: { name: string; version: string };
  capabilities: Record<string, unknown>;
  track: (d: McpDiscovery) => void;
  clock?: () => number;
};

export type OpenDiscovery = {
  /** Answers one open-method request. The caller has already checked there
   * is no bearer and that `openDiscoveryMethod` named `method`. */
  handle(req: Request, res: Response, method: string): Promise<void>;
};

/** Anyone can call the open methods, so a failure answers in fixed words and
 * the cause goes to the log only: a database error names tables and columns. */
async function opaque<T>(method: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    console.error(`[open-discovery] ${method} failed:`, err instanceof Error ? err.message : err);
    throw new McpError(ErrorCode.InternalError, `${method} is unavailable right now`);
  }
}

export function createOpenDiscovery(deps: OpenDiscoveryDeps): OpenDiscovery {
  const minute: RateLimiter = createRateLimiter({ limit: DISCOVERY_LIMITS.perMinute, windowMs: 60_000, clock: deps.clock });
  const hour: RateLimiter = createRateLimiter({ limit: DISCOVERY_LIMITS.perHour, windowMs: 60 * 60_000, clock: deps.clock });
  // A refused request is still an event, but a flood from one address is
  // one event a minute, not one per request.
  const refusedEvents: RateLimiter = createRateLimiter({ limit: 1, windowMs: 60_000, clock: deps.clock });
  if (typeof setInterval !== "undefined" && !deps.clock) {
    setInterval(() => {
      minute.sweep();
      hour.sweep();
      refusedEvents.sweep();
    }, 5 * 60_000).unref?.();
  }

  function buildServer(instructions: string): Server {
    const server = new Server(deps.serverInfo, { capabilities: deps.capabilities, instructions });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await opaque("tools/list", deps.listTools) }));
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: (await opaque("prompts/list", deps.listPrompts)) as never,
    }));
    return server;
  }

  return {
    async handle(req, res, method) {
      const ip = requestClientIp(req);
      const keys = discoveryKeys(req, deps.salt);
      const info = extractClientInfo(req.body);
      const headerVersion = req.headers["mcp-protocol-version"];
      const event = (outcome: McpDiscovery["outcome"]): McpDiscovery => ({
        method,
        clientName: cleanClientName(info.name) ?? "",
        clientVersion: cleanClientName(info.version) ?? "",
        userAgent: cleanUserAgent(req.headers["user-agent"]) ?? "",
        protocolVersion: (info.protocolVersion ?? (typeof headerVersion === "string" ? headerVersion : "")).slice(0, 50),
        outcome,
        serverSha: deps.serverSha,
        discoveryId: keys.discovery_id,
        peerHash: keys.peer_hash,
      });

      if (!discoveryOriginAllowed(req.headers.origin, deps.baseUrl)) {
        if (refusedEvents.check(ip).ok) deps.track(event("origin_refused"));
        res.status(403).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Forbidden: Origin not allowed" },
          id: null,
        });
        return;
      }

      const perMinute = minute.check(ip);
      const perHour = perMinute.ok ? hour.check(ip) : { ok: true, retryAfterMs: 0 };
      if (!perMinute.ok || !perHour.ok) {
        if (refusedEvents.check(ip).ok) deps.track(event("rate_limited"));
        const retryAfterMs = Math.max(perMinute.retryAfterMs, perHour.retryAfterMs);
        res
          .status(429)
          .set("Retry-After", String(Math.ceil(retryAfterMs / 1000)))
          .json({ jsonrpc: "2.0", error: { code: -32000, message: "Too many requests" }, id: null });
        return;
      }

      deps.track(event("served"));
      // Stateless: no session id generator, so the transport issues none and
      // keeps nothing; a fresh pair per request, closed with the response.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const server = buildServer(await deps.instructions());
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    },
  };
}

/** A value cached for `ttlMs`, refreshed on the first read after; a failed
 * refresh is thrown to the caller and not cached. The open list is read by
 * anyone, so it is not a database read per request. */
export function cachedFor<T>(ttlMs: number, load: () => Promise<T>, clock: () => number = Date.now): () => Promise<T> {
  let value: { at: number; v: T } | null = null;
  let inflight: Promise<T> | null = null;
  return async () => {
    if (value && clock() - value.at < ttlMs) return value.v;
    if (!inflight) {
      inflight = load()
        .then((v) => {
          value = { at: clock(), v };
          return v;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}

/** Exported for the server's wiring and its test. */
export async function publicInstructionsFor(
  launched: () => Promise<Set<string>>,
  publicIds: readonly string[],
  render: (ids: Iterable<string>) => string
): Promise<string> {
  const ids = await launched();
  return render([...ids].filter((id) => publicIds.includes(id)));
}

