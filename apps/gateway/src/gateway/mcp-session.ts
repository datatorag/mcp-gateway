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

/**
 * The way to close a user's live sessions from code that cannot hold the
 * session map. The map is a local of the Express server (`server.ts`), and a
 * dashboard API route runs in the app bundle of the same process, which loads
 * its own copy of every module. So the server registers a closer here, on
 * `globalThis` under `Symbol.for(...)` as the download-link store does, and
 * either bundle's copy of this file finds the same one.
 */
type SessionCloser = (userId: string) => Promise<number>;
const SESSION_CLOSER = Symbol.for("datatorag.mcp-session.closer");
const closerSlot = globalThis as unknown as Record<symbol, SessionCloser | null | undefined>;

/** Called once by the server that owns the session map; null clears it. */
export function registerSessionCloser(closer: SessionCloser | null): void {
  closerSlot[SESSION_CLOSER] = closer;
}

/**
 * Closes every live MCP session of a user through the registered closer.
 * Returns how many were closed, or null when nothing in this process owns
 * sessions (a test, a script), so a caller can say what it did not do. Never
 * throws: a closer that fails is logged and reads as null.
 */
export async function closeLiveSessionsForUser(userId: string): Promise<number | null> {
  const closer = closerSlot[SESSION_CLOSER];
  if (!closer) return null;
  try {
    return await closer(userId);
  } catch (err) {
    console.warn(`[mcp-session] closing sessions failed for user=${userId}: ${err instanceof Error ? err.message : "unknown error"}`);
    return null;
  }
}

/**
 * Tells each of a user's live MCP sessions that its tool list changed
 * (SCRUM-466): a provider's tools are listed only once it is connected, so a
 * connect that completes mid-conversation changes the list. A client that
 * ignores the notification still gets the new tools on its next tools/list.
 * Never throws; returns how many sessions were told.
 */
export async function notifyToolsChangedForUser(
  sessions: Map<string, { server: { sendToolListChanged(): Promise<void> }; userId: string }>,
  userId: string
): Promise<number> {
  let told = 0;
  for (const session of sessions.values()) {
    if (session.userId !== userId) continue;
    try {
      await session.server.sendToolListChanged();
      told++;
    } catch (err) {
      console.warn(`[mcp-session] list_changed failed for a session of user=${userId}`, err instanceof Error ? err.message : err);
    }
  }
  return told;
}
