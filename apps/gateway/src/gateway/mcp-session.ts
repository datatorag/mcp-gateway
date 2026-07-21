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

/**
 * Close every live session (and its SSE stream) belonging to a user — called
 * on token revocation (SEC-8). Without this, revoking a bearer 401s new
 * requests but an already-open stream keeps flowing until transport close.
 * Per-user is deliberately broad: a client whose bearer is still valid just
 * gets the 404 → silent re-initialize path on its next request, so the only
 * client that stays out is the revoked one.
 */
export async function closeSessionsForUser(
  sessions: Map<string, { transport: { close(): Promise<void> }; userId: string }>,
  userId: string
): Promise<number> {
  let closed = 0;
  for (const [id, session] of sessions) {
    if (session.userId !== userId) continue;
    closed++;
    // transport.onclose normally deletes the entry; delete here too so a
    // close() that throws can't leave a zombie session routable.
    sessions.delete(id);
    try {
      await session.transport.close();
    } catch (err) {
      console.warn(`[mcp-session] close failed for session of user=${userId}`, err);
    }
  }
  return closed;
}
