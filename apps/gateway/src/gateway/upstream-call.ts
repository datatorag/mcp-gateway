import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { callMcpToolOnce } from "./user-tools";
import { PLUGIN_ERROR_META_KEY, pluginFailureOf, type PluginFailure } from "./usage/classify";

/**
 * One call to a vendor's own MCP server (SCRUM-511; first written for the
 * parked official-mcp-proxy layer).
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

/**
 * What a usage row keeps of a failed vendor call: the kind of failure, in
 * our words, and nothing the vendor said. A vendor's error text can repeat
 * the call's arguments (a command, a query), and a usage row is behavior,
 * not content.
 */
export function upstreamErrorNote(serviceName: string, result: unknown): string {
  const failure = pluginFailureOf(result);
  if (!failure) return `${serviceName} reported an error for this call.`;
  return failure.kind === "http" ? `${serviceName}'s MCP server: HTTP ${failure.status}.` : `${serviceName}'s MCP server: ${failure.kind}.`;
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
