import { describe, it, expect, vi } from "vitest";
import { classifyMcpRequest, closeSessionsForUser, notifyToolsChangedForUser } from "./mcp-session";

// SCRUM-23: gateway restarts (every deploy) wipe the in-memory session map.
// The MCP Streamable HTTP spec says a request carrying an unknown/terminated
// session id gets a 404, and on 404 the client MUST transparently start a new
// session (re-initialize). We previously fell into the new-session init branch
// and returned a 400, which clients surface as "session expired" — forcing a
// manual re-auth even though the bearer token (stored in Postgres) was still
// perfectly valid.

describe("classifyMcpRequest", () => {
  it("routes to the live transport when the session is known", () => {
    expect(
      classifyMcpRequest({ method: "POST", sessionId: "s1", known: true })
    ).toBe("route");
    expect(
      classifyMcpRequest({ method: "GET", sessionId: "s1", known: true })
    ).toBe("route");
    expect(
      classifyMcpRequest({ method: "DELETE", sessionId: "s1", known: true })
    ).toBe("route");
  });

  it("404s an unknown session id so the client re-initializes (post-restart recovery)", () => {
    for (const method of ["POST", "GET", "DELETE"]) {
      expect(
        classifyMcpRequest({ method, sessionId: "stale", known: false })
      ).toBe("unknown_session");
    }
  });

  it("initializes a new session only on POST without a session id", () => {
    expect(
      classifyMcpRequest({ method: "POST", sessionId: undefined, known: false })
    ).toBe("initialize");
  });

  it("rejects non-POST requests without a session id", () => {
    expect(
      classifyMcpRequest({ method: "GET", sessionId: undefined, known: false })
    ).toBe("bad_request");
    expect(
      classifyMcpRequest({ method: "DELETE", sessionId: undefined, known: false })
    ).toBe("bad_request");
  });
});

// SEC-8: revoking a bearer must also tear down the user's live sessions —
// DB-side revocation 401s new requests but can't reach an open SSE stream.
describe("closeSessionsForUser", () => {
  const session = (userId: string, close = vi.fn().mockResolvedValue(undefined)) => ({
    userId,
    transport: { close },
  });

  it("closes and removes only the target user's sessions", async () => {
    const a1 = session("user-a");
    const a2 = session("user-a");
    const b = session("user-b");
    const sessions = new Map([
      ["s1", a1],
      ["s2", a2],
      ["s3", b],
    ]);

    const closed = await closeSessionsForUser(sessions, "user-a");

    expect(closed).toBe(2);
    expect(a1.transport.close).toHaveBeenCalled();
    expect(a2.transport.close).toHaveBeenCalled();
    expect(b.transport.close).not.toHaveBeenCalled();
    expect([...sessions.keys()]).toEqual(["s3"]);
  });

  it("still removes the session when transport.close() throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = session("user-a", vi.fn().mockRejectedValue(new Error("boom")));
    const sessions = new Map([["s1", bad]]);

    const closed = await closeSessionsForUser(sessions, "user-a");

    expect(closed).toBe(1);
    expect(sessions.size).toBe(0);
    warn.mockRestore();
  });

  it("is a no-op for a user with no live sessions", async () => {
    const other = session("user-b");
    const sessions = new Map([["s1", other]]);
    expect(await closeSessionsForUser(sessions, "user-a")).toBe(0);
    expect(sessions.size).toBe(1);
  });
});

/* SCRUM-466: a connect changes which tools a user's sessions list, and each
 * of that user's sessions, and nobody else's, is told. */
describe("notifyToolsChangedForUser", () => {
  const live = (userId: string, send = vi.fn().mockResolvedValue(undefined)) => ({ server: { sendToolListChanged: send }, userId });

  it("tells each of the user's sessions and no one else's", async () => {
    const a1 = live("user-a");
    const a2 = live("user-a");
    const b = live("user-b");
    const told = await notifyToolsChangedForUser(new Map([["s1", a1], ["s2", b], ["s3", a2]]), "user-a");
    expect(told).toBe(2);
    expect(a1.server.sendToolListChanged).toHaveBeenCalledTimes(1);
    expect(a2.server.sendToolListChanged).toHaveBeenCalledTimes(1);
    expect(b.server.sendToolListChanged).not.toHaveBeenCalled();
  });

  it("goes on past a session that cannot be told", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = live("user-a", vi.fn().mockRejectedValue(new Error("closed")));
    const good = live("user-a");
    expect(await notifyToolsChangedForUser(new Map([["s1", bad], ["s2", good]]), "user-a")).toBe(1);
    expect(good.server.sendToolListChanged).toHaveBeenCalled();
    warn.mockRestore();
  });
});
