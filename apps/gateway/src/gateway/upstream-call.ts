import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { tools } from "@datatorag-mcp/db";
import { vendorServed, type ConnectorRecord, type UpstreamServer } from "./connectors/registry";
import { buildPluginServerUrl, callMcpToolOnce, callPluginToolOnce, type PluginServerRow } from "./user-tools";
import { PLUGIN_ERROR_META_KEY, type PluginFailure } from "./usage/classify";

/**
 * Tools served by a vendor's own MCP server (official-mcp-proxy), and the one
 * place a server's endpoint is decided.
 *
 * A vendor call differs from a plugin call in three ways, and only these: the
 * URL is the vendor's, the user's token rides as `Authorization: Bearer` and
 * nothing else is sent (no `X-User-Token`, no plugin context header), and the
 * failure marker the gateway meters on is stamped HERE, because a vendor
 * stamps nothing. Without it a vendor that is down or rate-limiting would read
 * as the user's own error and be charged.
 *
 * Only what is seen at the transport is stamped. A tool result the vendor
 * marks `isError` (a bad channel, a missing scope) passes through as the
 * vendor's words and is the request's own, as a provider 4xx is today.
 */

/** A vendor that has not answered in this long, connect and call together,
 * is a transient failure. */
export const UPSTREAM_DEADLINE_MS = 30_000;

/** The cap our plugins apply to an answer, applied here for a vendor's. */
export const UPSTREAM_MAX_RESPONSE_CHARS = 900_000;

const TRUNCATED = "\n\n... [truncated: response exceeded 900KB]";

/** Where a server's tools are served: a plugin we run, at its address, or
 * the vendor's own MCP server, with the connector that declares it. Every
 * caller that turns a registry server into an endpoint asks this. */
export type ServiceEndpoint =
  | { kind: "plugin"; url: string }
  | { kind: "vendor"; url: string; connector: ConnectorRecord & { upstream: UpstreamServer } };

export function serviceEndpoint(server: PluginServerRow): ServiceEndpoint {
  const connector = vendorServed(server.slug);
  return connector
    ? { kind: "vendor", url: connector.upstream.url, connector }
    : { kind: "plugin", url: buildPluginServerUrl(server) };
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
function upstreamFailure(err: unknown, serviceName: string, timedOut: boolean): CallToolResult {
  if (timedOut || (err instanceof McpError && err.code === ErrorCode.RequestTimeout)) {
    return failed(`${serviceName}'s MCP server did not answer in time. Try again in a moment.`, { kind: "transient" });
  }
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
function namesMissingTool(result: CallToolResult, toolName: string): boolean {
  if (!result.isError) return false;
  const text = (result.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join(" ");
  return text.includes(`Tool ${toolName} not found`);
}

/** An answer cut to the cap, the text parts only, with the marker. */
function capUpstreamResult(result: CallToolResult): CallToolResult {
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
  url: string;
  /** The service's name on every surface, for the words of a failure. */
  serviceName: string;
  token: string;
  toolName: string;
  args: Record<string, unknown>;
  clientName: string;
  deadlineMs?: number;
}): Promise<CallToolResult> {
  // One deadline for the connect and the call together.
  const signal = AbortSignal.timeout(opts.deadlineMs ?? UPSTREAM_DEADLINE_MS);
  try {
    const result = (await callMcpToolOnce({
      url: opts.url,
      headers: { Authorization: `Bearer ${opts.token}` },
      toolName: opts.toolName,
      args: opts.args,
      clientName: opts.clientName,
      signal,
    })) as CallToolResult;
    if (namesMissingTool(result, opts.toolName)) {
      return failed(`This ${opts.serviceName} tool is no longer offered.`, { kind: "unknown_tool" });
    }
    return capUpstreamResult(result);
  } catch (err) {
    return upstreamFailure(err, opts.serviceName, signal.aborted);
  }
}

/** A tool call for a user with their token, to whichever serves the tool. The
 * one place the call is made from an endpoint, so no caller can send a
 * plugin's headers to a vendor or a vendor's bearer to a plugin. */
export async function callServiceToolOnce(opts: {
  endpoint: ServiceEndpoint;
  userToken: string;
  toolName: string;
  args: Record<string, unknown>;
  clientName: string;
  contextHeaders?: Record<string, string>;
}): Promise<CallToolResult> {
  const { endpoint } = opts;
  if (endpoint.kind === "plugin") {
    return (await callPluginToolOnce({ ...opts, serverUrl: endpoint.url })) as CallToolResult;
  }
  return callUpstreamTool({
    url: endpoint.url,
    serviceName: endpoint.connector.displayName,
    token: opts.userToken,
    toolName: opts.toolName,
    args: opts.args,
    clientName: opts.clientName,
  });
}

/** Whether a vendor-served tool may be called: only one with an enabled
 * registry row, so nothing the vendor added since the last review is
 * reachable by name. Always true for a plugin's tool. For a caller that does
 * not already hold the tool's row (the playground's direct call); the MCP
 * dispatch decides it from the row it reads anyway. */
export async function upstreamToolOffered(db: Database, endpoint: ServiceEndpoint, namespacedName: string): Promise<boolean> {
  if (endpoint.kind === "plugin") return true;
  const [row] = await db
    .select({ id: tools.id })
    .from(tools)
    .where(and(eq(tools.namespacedName, namespacedName), eq(tools.enabled, true)))
    .limit(1);
  return row !== undefined;
}

/** What a caller is told about a vendor tool that is not offered. */
export const UPSTREAM_TOOL_NOT_OFFERED = "This tool is not offered.";
