import { createHash } from "node:crypto";
import { MCPClient } from "@mastra/mcp";
import { RequestContext } from "@mastra/core/request-context";
import type { ToolsInput } from "@mastra/core/agent";
import type { Tool } from "@mastra/core/tools";
import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { mcpServers } from "@datatorag-mcp/db";
import { NAMESPACE_SEPARATOR } from "@/gateway/plugin-manager";
import {
  buildPluginServerUrl,
  listUserToolRows,
  type PluginServerRow,
} from "@/gateway/user-tools";
import { PLUGIN_SERVICE_MAP, getServiceToken } from "@/gateway/service-token";
import { classifyWrite, flattenToolResult, stripAccountArg } from "@/gateway/playground/tools";
import { capToolOutput } from "@/gateway/playground/cap";
import { trackToolCall } from "@/gateway/track";
import { RUN_ID_CONTEXT_KEY } from "@/mastra/llm-usage";
import { EPHEMERAL_CACHE_OPTIONS } from "@/mastra/agents/datatorag";
import { getDb } from "@/lib/db";

/**
 * The playground agent's connection to our plugin MCP servers.
 *
 * This module owns the CLIENT half of plugin connectivity for the agent only:
 * which servers exist, how a request is authenticated as a particular user, and
 * which tools that user may see. Everything else about plugins — cloning,
 * building, port allocation, process supervision, token vaulting, metering —
 * is unchanged and lives where it always did.
 *
 * The shape here is deliberate, and it is NOT the obvious one: a client — and
 * therefore an MCP session — PER USER, memoised, rather than one shared client
 * with the caller's identity travelling per request.
 *
 * One shared client is what a reading of the framework suggests, and it is
 * wrong against the servers we actually run. Our plugin servers keep a map of
 * session id → transport. The first request of a session builds the upstream
 * API client from the `X-User-Token` on THAT request; every later request is
 * routed by its `mcp-session-id` alone and the token header is never read
 * again. So a shared client establishes one session, and that session's
 * identity is whatever was present at initialize — which, since the handshake
 * happens outside any request, is nothing at all. Every call then runs
 * unauthenticated, and would run as user A if A had happened to open it.
 *
 * Hence: one session per user, opened with that user's token already on the
 * initialize request (see `tokensByServer` below — the token is bound into the
 * client's own `fetch`, not fished out of a request context that does not
 * reach the handshake). Two users can never share a session, because a session
 * is never reachable from more than one user's cache key.
 */

/** Header our plugin servers read to decide whose credentials to act with.
 * Same header the non-agent call path sends — the plugins have exactly one
 * notion of "who is this", and this must not become a second one. */
export const USER_TOKEN_HEADER = "X-User-Token";

/** Request-context key holding the id of the user the request is running as. */
export const USER_ID_CONTEXT_KEY = "userId";

/** Request-context key holding the access token for one plugin.
 *
 * Keyed PER SERVER, not one token for the whole request: a plugin's token is a
 * credential for that plugin's upstream (Google, Atlassian, …), and they are
 * not interchangeable. One shared key would hand every plugin every other
 * plugin's token — at best a failed call, at worst a credential leak across
 * providers. */
export function userTokenContextKey(serverSlug: string): string {
  return `userToken:${serverSlug}`;
}

/** Builds the per-request identity the plugin connections read from.
 *
 * Must be a real RequestContext, not a plain object that looks like one: the
 * value is consumed via `.get()` deep inside the client, so an object literal
 * type-errors here and would fail at call time rather than at construction. */
export function buildPluginRequestContext(opts: {
  userId: string;
  /** Plugin slug → that plugin's access token for this user. Slugs with no
   * connected account are simply absent. */
  tokensByServer: Record<string, string>;
}): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(USER_ID_CONTEXT_KEY, opts.userId);
  for (const [slug, token] of Object.entries(opts.tokensByServer)) {
    requestContext.set(userTokenContextKey(slug), token);
  }
  return requestContext;
}

/** Current access token per plugin slug for one user, refreshing where needed.
 * Plugins the user has not connected are omitted rather than mapped to an
 * empty string, so a missing token is never mistaken for a valid one. */
export async function loadUserPluginTokens(
  db: Database,
  userId: string,
  serverSlugs: string[]
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    serverSlugs.map(async (slug) => {
      const service = PLUGIN_SERVICE_MAP[slug];
      if (!service) return null;
      const token = await getServiceToken(db, userId, service);
      return token ? ([slug, token] as const) : null;
    })
  );
  return Object.fromEntries(entries.filter((e): e is [string, string] => e !== null));
}

/* -------------------------------------------------------------------------- */
/* Tool naming                                                                 */
/* -------------------------------------------------------------------------- */

/** Our namespaced tool name: `<slug>__<tool>`.
 *
 * The framework's own convention is `<server>_<tool>` — a SINGLE underscore —
 * and we cannot use it. Every tool we serve has underscores inside its own
 * name (`gmail_send`, `slides_batch_update`), so a single-underscore join is
 * ambiguous: `gws-mcp_docs_create` could split at three different places and
 * nothing in the string says which is right. The double underscore is what
 * makes the split unique, it is the name the registry stores, the name the MCP
 * front door serves, and the name the UI trims for display — so the mapping
 * happens here, at the one boundary where the server is still known
 * separately from the tool. */
export function toNamespacedName(serverSlug: string, toolName: string): string {
  return `${serverSlug}${NAMESPACE_SEPARATOR}${toolName}`;
}

/* -------------------------------------------------------------------------- */
/* The per-user client                                                         */
/* -------------------------------------------------------------------------- */

/** Active plugin servers, with whatever address each is currently reachable at.
 * Ports are assigned by the plugin supervisor and recorded on the row; we read
 * them, we never pick them. */
export async function listPluginServers(db: Database): Promise<PluginServerRow[]> {
  return db
    .select({
      slug: mcpServers.slug,
      containerPort: mcpServers.containerPort,
      githubRepoUrl: mcpServers.githubRepoUrl,
    })
    .from(mcpServers)
    .where(eq(mcpServers.status, "active"));
}

/** Plugin slug → this user's token for that plugin. Absent means not connected;
 * never an empty string, so "missing" is never mistaken for "valid". */
export type PluginTokens = Record<string, string>;

/** The tokens for one request, read back out of its context.
 *
 * The slugs have to be supplied because a `RequestContext` is a bag with no
 * listable keys — the caller already knows which plugins exist, so it says so
 * rather than the context guessing. */
export function readPluginTokens(
  requestContext: RequestContext | undefined | null,
  serverSlugs: string[]
): PluginTokens {
  const tokens: PluginTokens = {};
  for (const slug of serverSlugs) {
    const token = requestContext?.get(userTokenContextKey(slug));
    if (typeof token === "string" && token.length > 0) tokens[slug] = token;
  }
  return tokens;
}

/** One client for ONE user, holding one session per plugin, opened as them.
 *
 * `tokensByServer` is the load-bearing argument. Bound into the per-server
 * `fetch` closure, it puts the token on EVERY outgoing request including the
 * initialize handshake — and initialize is the only one our plugin servers read
 * it on. A token supplied any other way arrives too late to decide who the
 * session is.
 *
 * The request-context lookup is kept as a fallback rather than removed. It is
 * correct and harmless for a plugin that does read the header per call, and it
 * is what a client built without bound tokens (a test, a tokenless probe) still
 * has. The bound token WINS where both exist, so the header can never disagree
 * with the identity the session was actually opened as. */
export function createPluginMCPClient(
  servers: PluginServerRow[],
  opts?: { id?: string; timeout?: number; tokensByServer?: PluginTokens }
): MCPClient {
  const boundTokens = opts?.tokensByServer ?? {};
  return new MCPClient({
    id: opts?.id ?? "datatorag-playground-plugins",
    ...(opts?.timeout ? { timeout: opts.timeout } : {}),
    servers: Object.fromEntries(
      servers.map((server) => [
        server.slug,
        {
          url: new URL(buildPluginServerUrl(server)),
          fetch: (
            url: string | URL,
            init?: RequestInit,
            requestContext?: RequestContext | null
          ) => {
            const contextToken = requestContext?.get(userTokenContextKey(server.slug));
            const token =
              boundTokens[server.slug] ??
              (typeof contextToken === "string" ? contextToken : undefined);
            const headers = new Headers(init?.headers);
            if (typeof token === "string" && token.length > 0) {
              headers.set(USER_TOKEN_HEADER, token);
            }
            return fetch(url, { ...init, headers });
          },
        },
      ])
    ),
  });
}

/* -------------------------------------------------------------------------- */
/* The per-user client cache                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How long a user's plugin sessions are kept alive after their last use, and
 * how many users' worth we keep at once.
 *
 * A client per user is a client per user, so this cache grows with traffic and
 * has to be bounded. The policy is idle-TTL plus an LRU cap, both enforced by a
 * sweep on every lookup — no timers, because a timer in a serverless-shaped
 * process either keeps it alive or never fires. Eviction always `disconnect()`s,
 * which is what actually terminates the MCP sessions on the plugin servers;
 * dropping the reference alone would leak a session per user, on every plugin,
 * for the lifetime of the process.
 *
 * The TTL is generous relative to a chat turn and short relative to an access
 * token's life, so the common case is a warm session for the length of a
 * conversation and a cold one the next day. Nothing depends on the exact
 * numbers: a swept-out client costs one handshake to rebuild.
 */
const CLIENT_IDLE_TTL_MS = 10 * 60_000;
const MAX_CACHED_CLIENTS = 200;

type CachedClient = { key: string; client: MCPClient; lastUsedAt: number };

/** Insertion-ordered, and re-inserted on every hit, so iteration order IS
 * least-recently-used order. */
const clientCache = new Map<string, CachedClient>();

function disposeCachedClient(entry: CachedClient): void {
  clientCache.delete(entry.key);
  void entry.client.disconnect().catch(() => {});
}

function sweepClientCache(now: number): void {
  for (const entry of Array.from(clientCache.values())) {
    if (now - entry.lastUsedAt > CLIENT_IDLE_TTL_MS) disposeCachedClient(entry);
  }
  while (clientCache.size > MAX_CACHED_CLIENTS) {
    const oldest = clientCache.values().next().value;
    if (!oldest) break;
    disposeCachedClient(oldest);
  }
}

/**
 * An opaque digest of the tokens a client was built with.
 *
 * It exists so that a REFRESHED TOKEN GETS A NEW SESSION. A session pins the
 * credential it was opened with; keep the session and the user keeps acting
 * with a token that expired hours ago. Changing the fingerprint changes the
 * cache key, so the old client is left to age out and a new session opens with
 * the current token — the one correct behaviour that a user-id-only key cannot
 * produce.
 *
 * The digest is one-way and is only ever compared to another digest. It must
 * never be logged, returned in an error, or surfaced anywhere a token's
 * presence could be confirmed by guessing at its input.
 */
function tokenFingerprint(tokensByServer: PluginTokens): string {
  const material = Object.keys(tokensByServer)
    .sort()
    .map((slug) => `${slug}\u0000${tokensByServer[slug]}`)
    .join("\u0001");
  return createHash("sha256").update(material).digest("hex");
}

/**
 * This user's plugin client, memoised.
 *
 * The key is (server set, user, token fingerprint) and every part of it earns
 * its place:
 * - the SERVER SET, so installing, removing or restarting a plugin invalidates
 *   the client rather than leaving it pointed at a port nobody is listening on;
 * - the USER, so no two people can ever be handed the same session — the
 *   property that makes cross-tenant leakage structurally impossible here
 *   rather than merely unobserved;
 * - the TOKEN FINGERPRINT, so a refresh opens a new session instead of pinning
 *   a stale credential for as long as the process lives.
 */
export function getPluginMCPClient(
  servers: PluginServerRow[],
  opts: { userId: string; tokensByServer: PluginTokens }
): MCPClient {
  const signature = servers
    .map((s) => `${s.slug}@${buildPluginServerUrl(s)}`)
    .sort()
    .join("|");
  const key = [signature, opts.userId, tokenFingerprint(opts.tokensByServer)].join("\u0002");

  const now = Date.now();
  sweepClientCache(now);

  const hit = clientCache.get(key);
  if (hit) {
    hit.lastUsedAt = now;
    // Re-insert to move it to the young end of the LRU order.
    clientCache.delete(key);
    clientCache.set(key, hit);
    return hit.client;
  }

  const client = createPluginMCPClient(servers, {
    // Distinct per cache entry: the framework keeps its own registry of clients
    // by id and hands back the existing one for a repeat id, which for a
    // per-user client would be the shared-client bug wearing a different hat.
    id: `datatorag-playground-plugins-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`,
    tokensByServer: opts.tokensByServer,
  });
  clientCache.set(key, { key, client, lastUsedAt: now });
  sweepClientCache(now);
  return client;
}

/** Disconnects and forgets every cached client. For tests and shutdown; nothing
 * in a request path should need it. */
export async function resetPluginClientCache(): Promise<void> {
  const entries = Array.from(clientCache.values());
  clientCache.clear();
  await Promise.allSettled(entries.map((entry) => entry.client.disconnect()));
}

/* -------------------------------------------------------------------------- */
/* The write gate                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Applies our policy to one tool the MCP client just handed us, in place.
 *
 * Two things happen here, and both are the kind of thing that is invisible
 * when it is missing:
 *
 * 1. THE WRITE GATE. `requireApproval` is set from the same classifier the
 *    previous agent loop used, so a tool that can change the user's data
 *    cannot reach the plugin server until the user has said yes. This is set
 *    as a plain property on the tool rather than by wrapping it: the runtime
 *    reads it off the tool itself, and it defaults to `false`, which is
 *    exactly why every tool has to be visited — a tool we forget to classify
 *    is a tool that runs unprompted, not a tool that errors.
 *
 * 2. THE ACCOUNT STRIP. See `stripAccountArg` — the playground has always
 *    acted as the user's default account, and it still does.
 *
 * 3. THE OUTPUT CAP. See `capToolOutput` — a tool result is re-sent on every
 *    later step of the turn, so an unbounded one is paid for repeatedly.
 *
 * All three wrap the tool the client handed us rather than the transport, so
 * they hold for every call the model can make, including one made on the
 * resume leg after an approval.
 *
 * Mutating rather than copying is safe and deliberate: the client builds these
 * tool objects fresh on every listing, so the object we are handed belongs to
 * this request. Copying a class instance would risk dropping whatever the
 * framework keeps off the own-property surface.
 *
 * NOT TAKEN UP YET, and worth knowing before anyone redesigns the classifier:
 * `requireApproval` also accepts `(input, ctx) => boolean | Promise<boolean>`,
 * so the decision may read the tool's ARGUMENTS and not just its name. That
 * makes rules like "sending mail outside the company needs approval, internal
 * does not" expressible, which a name-based classifier cannot say at all — it
 * sees `gws-mcp__gmail_send` and nothing about the recipient. Deliberately not
 * built here: an input-aware rule is a product policy decision, and this change
 * was scoped to keeping the existing gate's behaviour identical. The current
 * boolean form is the floor either way — an input-aware rule may raise a read
 * to needing approval, never lower a write.
 */
/**
 * What the agent path needs to report a tool call the way the gateway does.
 *
 * METERING BELONGS HERE, NOT AT THE STREAM. The first version of agent
 * metering watched `tool-output-available` chunks go past on the UI message
 * stream and called `trackToolCall` from there. That vantage point cannot see
 * a connector, a latency or an account, so it reported `connectorType: null`
 * and `latencyMs: 0` into `usage_events` — a table with no surface column that
 * feeds the customer-facing by-connector and latency views. Agent rows landed
 * there indistinguishable from gateway traffic and permanently wrong.
 *
 * This wrapper has all three: the slug is in the name, the connector follows
 * from it, the account arrives as an argument, and the clock brackets the real
 * call. Undefined `meter` means do not meter, which keeps the injectable tests
 * that build tools without a database working unchanged.
 */
export type ToolMeter = {
  db: Database;
  userId: string;
  /** Ties this call to the run that made it, so a turn's calls and its token
   * cost can be summed into one billable unit. */
  runId: string | null;
  /** The connector this tool's plugin maps to, or null for an unmapped one. */
  connectorType: string | null;
};

export function applyToolPolicy(
  namespacedName: string,
  tool: Tool<unknown, unknown, unknown, unknown>,
  meter?: ToolMeter
): Tool<unknown, unknown, unknown, unknown> {
  tool.requireApproval = classifyWrite(namespacedName);

  const execute = tool.execute;
  if (execute) {
    tool.execute = async (input, context) => {
      const startTime = Date.now();
      // Read BEFORE the strip: `account` is the caller's chosen mailbox and it
      // is what makes a usage row attributable to one of several connected
      // accounts. After stripAccountArg it is gone.
      const accountEmail = accountArgOf(input);
      try {
        const result = await execute(stripAccountArg(input), context);
        // Serialized ONCE and reused. Sizing and capping both need the
        // serialized form, and this runs on every tool call on a pre-cap
        // result, so a second traversal of a large mailbox or Drive listing is
        // real synchronous work on the event loop for nothing.
        const serialized = serialize(result);
        if (meter) {
          const { text, isError } = flattenToolResult(
            result as { content?: Array<{ type: string; text?: string }>; isError?: boolean }
          );
          report(meter, namespacedName, accountEmail, startTime, {
            responseSizeBytes: serialized?.length ?? null,
            errorMessage: isError ? text : null,
            outcome: {
              thrown: false,
              isError,
              errorMessage: isError ? text : null,
              source: "agent",
              toolName: namespacedName,
            },
          });
        }
        return capToolOutput(result, serialized);
      } catch (error) {
        if (meter) {
          const message = error instanceof Error ? error.message : "Unknown error";
          report(meter, namespacedName, accountEmail, startTime, {
            responseSizeBytes: null,
            errorMessage: message,
            outcome: {
              thrown: true,
              errorMessage: message,
              source: "agent",
              toolName: namespacedName,
            },
          });
        }
        throw error;
      }
    };
  }

  return tool;
}

/** The account the caller addressed, when they named one. */
function accountArgOf(input: unknown): string | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const account = (input as Record<string, unknown>).account;
  return typeof account === "string" && account.length > 0 ? account : undefined;
}

/** Serialize once, for both sizing and capping. Never throws: a result that
 * will not serialize (circular) must not turn a successful tool call into a
 * failed one just because we tried to measure it. */
function serialize(result: unknown): string | undefined {
  try {
    return JSON.stringify(result);
  } catch {
    return undefined;
  }
}

/** One usage row, from either outcome.
 *
 * Shared rather than written twice because the two branches differ in three
 * fields and agree in five, and a field added to one and missed on the other
 * produces an inconsistent row silently — which is the class of defect the
 * metering tests exist to catch, so reproducing it inside the fix would be a
 * poor joke. Fire-and-forget, as the gateway path does it: metering must never
 * slow a tool response, and trackToolCall never throws. */
function report(
  meter: ToolMeter,
  toolName: string,
  accountEmail: string | undefined,
  startTime: number,
  outcome: {
    responseSizeBytes: number | null;
    errorMessage: string | null;
    outcome: Parameters<typeof trackToolCall>[1]["outcome"];
  }
): void {
  void trackToolCall(meter.db, {
    userId: meter.userId,
    toolName,
    connectorType: meter.connectorType,
    accountEmail,
    latencyMs: Date.now() - startTime,
    runId: meter.runId,
    ...outcome,
  });
}

/** Attaches the tool-schema half of the prompt-cache pair to a resolved set.
 *
 * The breakpoint goes on the LAST tool because a cache prefix is cumulative:
 * marking the final schema makes the whole tool block a cache read on every
 * later step, where marking the first would cover only that one. Tool schemas
 * are the largest invariant part of the request — ~11k tokens for a user with
 * Workspace connected — and they are re-sent on every step of a multi-step
 * turn, which is the normal shape of a playground turn.
 *
 * "Last" is well defined: the set is a plain object built in a single pass
 * below, so its key order is its insertion order, and that is the order the
 * provider serializes. The order has to be STABLE across the steps of a turn
 * for the cache to hit at all — it is, because the set is resolved once per
 * request and reused for every step of that request.
 *
 * Returns the same object it was given; the marker is the only change. */
export function applyPromptCacheBreakpoint(tools: ToolsInput): ToolsInput {
  const values = Object.values(tools) as Array<{ providerOptions?: unknown }>;
  const lastTool = values[values.length - 1];
  if (lastTool === undefined) return tools;
  lastTool.providerOptions = { ...EPHEMERAL_CACHE_OPTIONS };
  return tools;
}

/* -------------------------------------------------------------------------- */
/* Per-request tool resolution                                                 */
/* -------------------------------------------------------------------------- */

export type PluginToolDeps = {
  client: MCPClient;
  /** The namespaced tools this user is allowed to see. Shared policy — a user
   * only gets tools from plugins whose service they have actually connected. */
  listAllowedToolNames: (userId: string) => Promise<Set<string>>;
  /** Where usage rows go. Omitted by the injectable tests, which build tool
   * sets with no database; omitting it turns metering off rather than
   * requiring every caller to supply a stub. */
  meterDb?: Database;
};

/**
 * The tool set for one request, named our way and filtered to this user.
 *
 * Grouped-by-server listing is used rather than the flat namespaced one for a
 * concrete reason: the flat list has already applied the framework's
 * single-underscore join, which is lossy for our names. Grouped, the server is
 * still a separate key, so we can join it ourselves and keep a name that can be
 * taken apart again.
 *
 * No user id in the context means no tools — a request that cannot say who it
 * is gets nothing, rather than everything.
 */
export async function resolvePluginTools(
  requestContext: RequestContext | undefined | null,
  deps: PluginToolDeps
): Promise<ToolsInput> {
  const userId = requestContext?.get(USER_ID_CONTEXT_KEY);
  if (typeof userId !== "string" || userId.length === 0) return {};

  const [allowed, toolsets] = await Promise.all([
    deps.listAllowedToolNames(userId),
    deps.client.listToolsets(),
  ]);

  // The run id rides the same context the model factory reads it from, so a
  // tool call and the model calls of the same turn carry one id. Absent on the
  // paths that do not mint one, and null is a fine value for it.
  const runId = requestContext?.get(RUN_ID_CONTEXT_KEY);
  const meterBase = deps.meterDb
    ? {
        db: deps.meterDb,
        userId,
        runId: typeof runId === "string" && runId.length > 0 ? runId : null,
      }
    : null;

  const resolved: ToolsInput = {};
  for (const [serverSlug, serverTools] of Object.entries(toolsets)) {
    // Derived once per server rather than per tool: every tool from one plugin
    // shares its connector.
    const connectorType = PLUGIN_SERVICE_MAP[serverSlug] ?? null;
    const meter = meterBase ? { ...meterBase, connectorType } : undefined;
    for (const [toolName, tool] of Object.entries(serverTools)) {
      const namespacedName = toNamespacedName(serverSlug, toolName);
      if (!allowed.has(namespacedName)) continue;
      // The KEY is what the model sees and what comes back on a tool call, so
      // this is where our naming convention is actually enforced.
      //
      // Every tool goes through applyToolPolicy — there is no path that puts a
      // tool in front of the model without one, which is the property that
      // makes the gate a gate rather than a habit.
      resolved[namespacedName] = applyToolPolicy(namespacedName, tool, meter);
    }
  }
  return applyPromptCacheBreakpoint(resolved);
}

/** The resolver the agent is built with: same as {@link resolvePluginTools},
 * wired to the real database and to THIS CALLER'S client. Kept separate so the
 * resolution logic above stays injectable and testable without either.
 *
 * The identity check is repeated here rather than left to `resolvePluginTools`
 * because the client is chosen by user: an anonymous request must not open a
 * session at all, not merely be handed no tools from one. */
export async function resolveUserPluginTools({
  requestContext,
}: {
  requestContext: RequestContext;
}): Promise<ToolsInput> {
  const userId = requestContext?.get(USER_ID_CONTEXT_KEY);
  if (typeof userId !== "string" || userId.length === 0) return {};

  const db = getDb();
  const servers = await listPluginServers(db);
  // The tokens are already on the request context — the route loaded them when
  // it built it — so this costs no extra database work.
  const client = getPluginMCPClient(servers, {
    userId,
    tokensByServer: readPluginTokens(requestContext, servers.map((s) => s.slug)),
  });

  return resolvePluginTools(requestContext, {
    client,
    meterDb: db,
    listAllowedToolNames: async (id) => {
      const rows = await listUserToolRows(db, id);
      return new Set(rows.map((row) => row.namespacedName));
    },
  });
}
