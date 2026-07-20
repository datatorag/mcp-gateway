/**
 * Session routing for the /mcp Streamable HTTP endpoint (SCRUM-23).
 *
 * The session map lives in process memory, so every deploy/restart wipes it
 * while clients still hold their old `mcp-session-id`. Per the MCP Streamable
 * HTTP spec, a request carrying an unknown or terminated session id must get
 * an HTTP 404 — clients then transparently start a new session with a fresh
 * InitializeRequest. Auth is unaffected: bearer tokens live in Postgres and
 * survive restarts. Returning anything else (we used to fall through to the
 * init branch and 400) makes clients surface "session expired" and demand a
 * manual re-auth for what should be a silent reconnect.
 */
export type McpSessionAction =
  | "route" // known session — hand to its live transport
  | "unknown_session" // stale/unknown id — 404 so the client re-initializes
  | "initialize" // no session id + POST — new-session InitializeRequest
  | "bad_request"; // no session id + GET/DELETE — nothing to stream or delete

export function classifyMcpRequest(req: {
  method: string;
  sessionId: string | undefined;
  known: boolean;
}): McpSessionAction {
  if (req.sessionId) return req.known ? "route" : "unknown_session";
  if (req.method === "POST") return "initialize";
  return "bad_request";
}
