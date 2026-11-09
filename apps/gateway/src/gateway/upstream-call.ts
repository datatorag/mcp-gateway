import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { tools } from "@datatorag-mcp/db";
import { CONNECTOR_REGISTRY, upstreamFor, type UpstreamServer } from "./connectors/registry";
import { callPluginToolOnce } from "./user-tools";
import { PLUGIN_ERROR_META_KEY, type PluginFailure } from "./usage/classify";

/**
 * One tool call to a vendor's own MCP server (official-mcp-proxy).
 *
 * The plugin call (`callPluginToolOnce`) differs in three ways, and only
 * these: the URL is the vendor's, the user's token rides as
 * `Authorization: Bearer` and nothing else is sent (no `X-User-Token`, no
 * plugin context header), and the failure marker the gateway meters on is
 * stamped HERE, because a vendor stamps nothing. Without it a vendor that is
 * down or rate-limiting would read as the user's own error and be charged.
 *
 * Only what is seen at the transport is stamped. A tool result the vendor
 * marks `isError` (a bad channel, a missing scope) passes through as the
 * vendor's words and is the request's own, as a provider 4xx is today.
 */

/** A vendor that has not answered in this long is a transient failure. */
export const UPSTREAM_DEADLINE_MS = 30_000;

/** The cap our plugins apply to an answer, applied here for a vendor's. */
export const UPSTREAM_MAX_RESPONSE_CHARS = 900_000;

const TRUNCATED = "\n\n... [truncated: response exceeded 900KB]";

/** The URL a call goes to: the declared one, with the declared params. */
export function upstreamUrl(upstream: UpstreamServer): URL {
  const url = new URL(upstream.url);
  for (const [k, v] of Object.entries(upstream.params ?? {})) url.searchParams.set(k, v);
  return url;
}

function failed(text: string, failure: PluginFailure): CallToolResult {
  return {
    content: [{ type: "text", text }],
    isError: true,
    _meta: { [PLUGIN_ERROR_META_KEY]: failure },
  };
}

/** A transport outcome as the client is told it, with the marker. Fixed
 * words only: a vendor's HTTP body is never passed on. */
export function upstreamFailure(err: unknown, serviceName: string): CallToolResult {
  if (err instanceof StreamableHTTPError) {
    const status = err.code;
    if (status === 401) {
      return failed(`${serviceName} refused the stored credential.`, { kind: "http", status: 401 });
    }
    if (status === 429) {
      return failed(`${serviceName} is rate-limiting these calls. Try again in a moment.`, { kind: "http", status: 429 });
    }
    if (status !== undefined && status >= 500) {
      return failed(`${serviceName}'s MCP server answered with an error. Try again in a moment.`, { kind: "http", status });
    }
    if (status !== undefined && status >= 400) {
      return failed(`${serviceName}'s MCP server refused the request (HTTP ${status}).`, { kind: "http", status });
    }
    // An answer that is not MCP at all (an HTML page from something in front
    // of the vendor): as good as no answer.
    return failed(`${serviceName}'s MCP server did not answer. Try again in a moment.`, { kind: "unreachable" });
  }
  if (err instanceof McpError) {
    if (err.code === ErrorCode.RequestTimeout) {
      return failed(`${serviceName}'s MCP server did not answer in time. Try again in a moment.`, { kind: "transient" });
    }
    if ((err.code === ErrorCode.InvalidParams || err.code === ErrorCode.MethodNotFound) && /not found|unknown tool/i.test(err.message)) {
      return failed(`This ${serviceName} tool is no longer offered.`, { kind: "unknown_tool" });
    }
    return failed(`${serviceName}'s MCP server refused the call: ${err.message}`, { kind: "refused" });
  }
  return failed(`${serviceName}'s MCP server did not answer. Try again in a moment.`, { kind: "unreachable" });
}

/** Whether a result is the SDK's own answer to a call for a tool the server
 * does not have (`MCP error -32602: Tool <name> not found`), which servers on
 * the SDK return as a result rather than a JSON-RPC error. Matched on the
 * exact tool name, so a vendor's ordinary "not found" about a channel or a
 * file is never read as a missing tool. */
export function namesMissingTool(result: CallToolResult, toolName: string): boolean {
  if (!result.isError) return false;
  const text = (result.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join(" ");
  return text.includes(`Tool ${toolName} not found`);
}

/** An answer cut to the cap, the text parts only, with the marker. */
export function capUpstreamResult(result: CallToolResult): CallToolResult {
  if (JSON.stringify(result).length <= UPSTREAM_MAX_RESPONSE_CHARS) return result;
  let budget = UPSTREAM_MAX_RESPONSE_CHARS;
  const content = [];
  for (const part of result.content ?? []) {
    if (part.type !== "text") continue;
    if (budget <= 0) break;
    const text = part.text.length > budget ? part.text.slice(0, budget) + TRUNCATED : part.text;
    budget -= part.text.length;
    content.push({ type: "text" as const, text });
  }
  return { ...(result.isError ? { isError: true } : {}), content };
}

export async function callUpstreamTool(opts: {
  upstream: UpstreamServer;
  /** The service's name on every surface, for the words of a failure. */
  serviceName: string;
  token: string;
  toolName: string;
  args: Record<string, unknown>;
  clientName: string;
  deadlineMs?: number;
}): Promise<CallToolResult> {
  const deadline = opts.deadlineMs ?? UPSTREAM_DEADLINE_MS;
  const transport = new StreamableHTTPClientTransport(upstreamUrl(opts.upstream), {
    requestInit: { headers: { Authorization: `Bearer ${opts.token}` } },
  });
  const client = new Client({ name: opts.clientName, version: "0.1.0" }, { capabilities: {} });
  try {
    await client.connect(transport, { timeout: deadline });
    const result = (await client.callTool({ name: opts.toolName, arguments: opts.args }, undefined, {
      timeout: deadline,
    })) as CallToolResult;
    if (namesMissingTool(result, opts.toolName)) {
      return failed(`This ${opts.serviceName} tool is no longer offered.`, { kind: "unknown_tool" });
    }
    return capUpstreamResult(result);
  } catch (err) {
    return upstreamFailure(err, opts.serviceName);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** A tool call for a user with their token, to whichever serves the tool:
 * the vendor's own MCP server when the connector declares one
 * (official-mcp-proxy), else our plugin. The one place that choice is made,
 * so no caller can send a plugin's headers to a vendor or a vendor's bearer
 * to a plugin. `serverUrl` is the plugin's and is not used for a vendor. */
export async function callServiceToolOnce(opts: {
  serverSlug: string;
  serverUrl: string;
  userToken: string;
  toolName: string;
  args: Record<string, unknown>;
  clientName: string;
  contextHeaders?: Record<string, string>;
}): Promise<Awaited<ReturnType<Client["callTool"]>>> {
  const upstream = upstreamFor(opts.serverSlug);
  if (!upstream) return callPluginToolOnce(opts);
  return callUpstreamTool({
    upstream,
    serviceName: CONNECTOR_REGISTRY.find((c) => c.pluginSlug === opts.serverSlug)?.displayName ?? opts.serverSlug,
    token: opts.userToken,
    toolName: opts.toolName,
    args: opts.args,
    clientName: opts.clientName,
  });
}

/** Whether a vendor-served tool may be called (official-mcp-proxy): only one
 * with an enabled registry row, so nothing the vendor added since the last
 * review is reachable by name. Always true for a plugin's tool, whose rule
 * stays as it is. The one gate both call paths ask. */
export async function upstreamToolOffered(db: Database, serverSlug: string, namespacedName: string): Promise<boolean> {
  if (!upstreamFor(serverSlug)) return true;
  const [row] = await db
    .select({ id: tools.id })
    .from(tools)
    .where(and(eq(tools.namespacedName, namespacedName), eq(tools.enabled, true)))
    .limit(1);
  return row !== undefined;
}

/** What a caller is told about a vendor tool that is not offered. */
export const UPSTREAM_TOOL_NOT_OFFERED = "This tool is not offered.";
