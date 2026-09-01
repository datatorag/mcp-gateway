import { RequestContext } from "@mastra/core/request-context";
import type { ToolsInput } from "@mastra/core/agent";
import { jsonSchema, type JSONSchema7 } from "ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, BUILT_IN_TOOLS } from "@/gateway/mcp-server";
import { ConnectionPool } from "@/gateway/pool";
import { classifyWrite } from "@/gateway/playground/tools";
import { capToolOutput } from "@/gateway/playground/cap";
import { EPHEMERAL_CACHE_OPTIONS } from "@/mastra/agents/datatorag";
import { getDb } from "@/lib/db";
import { buildIntrospectionTools } from "@/mastra/tools/introspection";

/**
 * The dashboard agent's connection to the gateway's own MCP (SCRUM-188).
 *
 * The agent is an ORDINARY CLIENT of the same MCP server every external
 * client talks to, constructed in-process with the authenticated session's
 * userId. Ruled by Manuel: the agent should just be another client
 * connecting to our MCP; the only difference is that the user is already
 * authenticated because they already logged in.
 *
 * What that dissolves, deliberately, relative to the previous design where
 * the agent wired straight to the plugin processes:
 *
 *  - No token loading, scope threading, or per-server credential context:
 *    the MCP server resolves the per-call token, account, and scope gate
 *    itself, exactly as it does for every client.
 *  - No per-user client cache, sweep, or token fingerprint: the pair is
 *    constructed per request and garbage-collected with it. The registry
 *    read it costs per turn is the read the old path also made per turn.
 *  - NO METERING HERE. One tool call is one event, emitted at the MCP
 *    layer. The agent layer emits nothing and meters nothing — not a
 *    reduced count, no count at all (per SCRUM-188). Client identity on
 *    the event (SCRUM-189) is how agent traffic stays attributable.
 *
 * What stays agent-side: the write-approval WIRING (the policy is
 * gateway-side; see requireApprovalFor), the prompt-cache breakpoint, the
 * output cap, and the UI-action introspection tools.
 */

/** Request-context key holding the id of the user the request is running as. */
export const USER_ID_CONTEXT_KEY = "userId";

/** How the in-process client introduces itself at the MCP initialize
 * handshake. Lands as client_name on every tool_call event (SCRUM-189), so
 * agent traffic stays separable from external clients without a second
 * event or a special-cased surface. */
export const AGENT_CLIENT_NAME = "datatorag-agent";

/** The OAuth client id dashboard sessions authenticate under (the same
 * literal auth.ts stamps on web session tokens). The agent acts inside that
 * session, so its calls carry the session's own client id — nothing is
 * minted for the agent, per the ruling that it needs no second identity. */
export const WEB_OAUTH_CLIENT_ID = "web";

/** Builds the per-request identity the tool resolver reads from.
 *
 * Must be a real RequestContext, not a plain object that looks like one: the
 * value is consumed via `.get()` inside the resolver and the model factory,
 * so an object literal type-errors here and would fail at call time rather
 * than at construction. Token/account/scope threading is gone (SCRUM-188):
 * identity is the only thing the agent layer still carries. */
export function buildPluginRequestContext(opts: { userId: string }): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(USER_ID_CONTEXT_KEY, opts.userId);
  return requestContext;
}

/** Shared across requests because a ConnectionPool is per-plugin-server and
 * credential-free by invariant (per-user tokens always take the one-shot
 * path inside the MCP server). Only legacy non-service plugins ever touch
 * it, but the server constructor requires one. */
const agentPool = new ConnectionPool();

/** Declared approvals for the gateway built-ins, read from the same registry
 * object a new built-in is added to. Everything else classifies by name. */
const BUILTIN_APPROVAL: ReadonlyMap<string, "read" | "write"> = new Map(
  BUILT_IN_TOOLS.map((t) => [t.definition.name, t.approval])
);

/**
 * Whether a tool named `name` needs user approval before running (SCRUM-188).
 *
 * Built-ins use their DECLARED approval (they live outside the plugin
 * registry, so the name classifier's snapshot never covers them); every
 * other name goes through classifyWrite, whose default is fail-closed: a
 * name it does not recognise requires approval. There is no third source.
 */
export function requireApprovalFor(name: string): boolean {
  const declared = BUILTIN_APPROVAL.get(name);
  if (declared !== undefined) return declared === "write";
  return classifyWrite(name);
}

/** The MCP tool-definition fields the wrapper consumes. */
type McpToolDef = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Wraps the MCP server's tool list into the agent runtime's tool shape.
 *
 * EVERY tool the model can see passes through here — there is no path that
 * puts a tool in front of the model without the approval requirement being
 * set, which is the property that makes the gate a gate rather than a
 * habit. (The three UI-action introspection tools are merged after this set
 * and DECLARE their own approvals; the boundary suite asserts both groups.)
 *
 * Injectable for tests: callers pass the connected client's methods.
 */
export function wrapMcpTools(
  defs: McpToolDef[],
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
): ToolsInput {
  const resolved: ToolsInput = {};
  for (const def of defs) {
    resolved[def.name] = {
      description: def.description ?? "",
      inputSchema: jsonSchema(def.inputSchema as JSONSchema7),
      requireApproval: requireApprovalFor(def.name),
      // The result is returned as the MCP server shaped it — including its
      // worded scope refusals and error rewrites — capped for context size.
      // No metering, no rewriting, no account handling here: the server did
      // all of that, for this client like any other.
      execute: async (input: unknown) => {
        const result = await callTool(
          def.name,
          (input ?? {}) as Record<string, unknown>
        );
        return capToolOutput(result);
      },
    } as ToolsInput[string];
  }
  return applyPromptCacheBreakpoint(resolved);
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
 * above, so its key order is its insertion order, and that is the order the
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

/**
 * The tool set for one request: the gateway's own MCP, consumed in-process.
 *
 * No user id in the context means no tools — a request that cannot say who
 * it is gets nothing, rather than everything. The `surface: "agent"` hint
 * changes only the WORDING of scope refusals (the model gets steered to the
 * inline reconnect control it can render); the gate policy is the server's
 * own, identical for every client.
 */
export async function resolveUserPluginTools({
  requestContext,
}: {
  requestContext: RequestContext;
}): Promise<ToolsInput> {
  const userId = requestContext?.get(USER_ID_CONTEXT_KEY);
  if (typeof userId !== "string" || userId.length === 0) return {};

  const db = getDb();
  const server = createMcpServer(userId, db, agentPool, {
    surface: "agent",
    clientId: WEB_OAUTH_CLIENT_ID,
  });
  const client = new Client(
    { name: AGENT_CLIENT_NAME, version: "1.0.0" },
    { capabilities: {} }
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const { tools } = await client.listTools();
  const wrapped = wrapMcpTools(tools as McpToolDef[], (name, args) =>
    client.callTool({ name, arguments: args })
  );

  // Introspection tools are OURS, not a plugin's: UI actions on this user's
  // own account, no identity argument, approval DECLARED rather than
  // classified. Added after the MCP set so the prompt-cache breakpoint stays
  // on an MCP tool schema, which is the large invariant block worth caching.
  return { ...wrapped, ...buildIntrospectionTools({ db, userId }) };
}
