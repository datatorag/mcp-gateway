import { describe, it, expect } from "vitest";
import { classifyMcpRequest } from "./mcp-session";

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
