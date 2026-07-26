import { MCPClient } from "@mastra/mcp";
import { RequestContext } from "@mastra/core/request-context";
import type { ToolsInput } from "@mastra/core/agent";
import type { Tool } from "@mastra/core/tools";
import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { mcpServers } from "@datatorag-mcp/db";
import { NAMESPACE_SEPARATOR } from "@/gateway/plugin-manager";
import { buildPluginServerUrl, listUserToolRows } from "@/gateway/user-tools";
import { PLUGIN_SERVICE_MAP, getServiceToken } from "@/gateway/service-token";
import { classifyWrite, stripAccountArg } from "@/gateway/playground/tools";
import { capToolOutput } from "@/gateway/playground/cap";
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
 * The shape here is deliberate: ONE client for the process, holding one
 * connection per plugin, with the caller's identity travelling per request
 * instead of per client. A client per user would mean a fresh MCP handshake
 * for every visitor and a pile of sockets to reap; the framework's request
 * context exists precisely so that is unnecessary.
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

/** Inverse of {@link toNamespacedName}; null for anything not namespaced.
 * Splits on the FIRST separator, so underscores in the tool name survive. */
export function parseNamespacedToolName(
  namespacedName: string
): { serverSlug: string; toolName: string } | null {
  const at = namespacedName.indexOf(NAMESPACE_SEPARATOR);
  if (at === -1) return null;
  return {
    serverSlug: namespacedName.slice(0, at),
    toolName: namespacedName.slice(at + NAMESPACE_SEPARATOR.length),
  };
}

/** The id the framework stamps on a tool it sourced from an MCP server:
 * `<server>_<tool>`. Exposed so the mapping below is stated once and testable,
 * not open-coded wherever someone happens to meet one of these ids. */
export function toFrameworkToolId(serverSlug: string, toolName: string): string {
  return `${serverSlug}_${toolName}`;
}

/** Framework tool id → our namespaced name, given the server it came from.
 *
 * The server has to be supplied: it CANNOT be recovered from the id alone, for
 * the ambiguity reason above. Returns null if the id does not belong to that
 * server. */
export function fromFrameworkToolId(
  serverSlug: string,
  frameworkToolId: string
): string | null {
  const prefix = `${serverSlug}_`;
  if (!frameworkToolId.startsWith(prefix)) return null;
  return toNamespacedName(serverSlug, frameworkToolId.slice(prefix.length));
}

/* -------------------------------------------------------------------------- */
/* The shared client                                                           */
/* -------------------------------------------------------------------------- */

export type PluginServerRow = {
  slug: string;
  containerPort: number | null;
  githubRepoUrl: string | null;
};

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

/** One client, one connection per plugin, identity supplied per request.
 *
 * The per-server `fetch` is the whole trick: it receives the request context as
 * a third argument, so the outgoing HTTP request can carry the token of the
 * user this particular call belongs to while the connection underneath stays
 * shared. The header is set only when a token is present — the connection
 * handshake happens outside any request and legitimately has none. */
export function createPluginMCPClient(
  servers: PluginServerRow[],
  opts?: { id?: string; timeout?: number }
): MCPClient {
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
            const token = requestContext?.get(userTokenContextKey(server.slug));
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

/** Process-wide client, rebuilt only when the set of plugins or their addresses
 * changes (a plugin installed, removed, or restarted on a new port). The old
 * client is disconnected on the way out so its sockets do not accumulate. */
let cached: { signature: string; client: MCPClient } | undefined;

export async function getPluginMCPClient(db: Database): Promise<MCPClient> {
  const servers = await listPluginServers(db);
  const signature = servers
    .map((s) => `${s.slug}@${buildPluginServerUrl(s)}`)
    .sort()
    .join("|");
  if (cached?.signature === signature) return cached.client;

  const previous = cached?.client;
  cached = { signature, client: createPluginMCPClient(servers) };
  if (previous) void previous.disconnect().catch(() => {});
  return cached.client;
}

/** Test seam: forget the memoised client. */
export function resetPluginMCPClient(): void {
  cached = undefined;
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
 */
export function applyToolPolicy(
  namespacedName: string,
  tool: Tool<unknown, unknown, unknown, unknown>
): Tool<unknown, unknown, unknown, unknown> {
  tool.requireApproval = classifyWrite(namespacedName);

  const execute = tool.execute;
  if (execute) {
    tool.execute = async (input, context) =>
      capToolOutput(await execute(stripAccountArg(input), context));
  }

  return tool;
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
  const names = Object.keys(tools);
  const lastName = names[names.length - 1];
  if (lastName === undefined) return tools;
  const lastTool = tools[lastName] as { providerOptions?: unknown } | undefined;
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

  const resolved: ToolsInput = {};
  for (const [serverSlug, serverTools] of Object.entries(toolsets)) {
    for (const [toolName, tool] of Object.entries(serverTools)) {
      const namespacedName = toNamespacedName(serverSlug, toolName);
      if (!allowed.has(namespacedName)) continue;
      // The KEY is what the model sees and what comes back on a tool call, so
      // this is where our naming convention is actually enforced.
      //
      // Every tool goes through applyToolPolicy — there is no path that puts a
      // tool in front of the model without one, which is the property that
      // makes the gate a gate rather than a habit.
      resolved[namespacedName] = applyToolPolicy(namespacedName, tool);
    }
  }
  return applyPromptCacheBreakpoint(resolved);
}

/** The resolver the agent is built with: same as {@link resolvePluginTools},
 * wired to the real database and the shared client. Kept separate so the
 * resolution logic above stays injectable and testable without either. */
export async function resolveUserPluginTools({
  requestContext,
}: {
  requestContext: RequestContext;
}): Promise<ToolsInput> {
  const db = getDb();
  return resolvePluginTools(requestContext, {
    client: await getPluginMCPClient(db),
    listAllowedToolNames: async (userId) => {
      const rows = await listUserToolRows(db, userId);
      return new Set(rows.map((row) => row.namespacedName));
    },
  });
}
