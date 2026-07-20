import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// SEC-1: the plugin-connect callback must resolve the connected user from the
// session (never from `state`) and require the CSRF nonce cookie to match the
// nonce echoed in `state`.

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({
  getSessionUserId: () => getSessionUserId(),
}));

const selectLimit = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
    insert: () => ({ values: vi.fn().mockResolvedValue(undefined) }),
    update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) }),
  },
}));

import { GET } from "./route";

function callbackReq(
  query: Record<string, string>,
  cookies: Record<string, string> = {}
): NextRequest {
  const url = new URL(
    "http://localhost/api/servers/gws-mcp/connect/callback"
  );
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(url, cookie ? { headers: { cookie } } : undefined);
}

const ctx = { params: Promise.resolve({ slug: "gws-mcp" }) };

describe("GET /api/servers/:slug/connect/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionUserId.mockResolvedValue("user-1");
    selectLimit.mockResolvedValue([]); // no server by default → 404 past guards
  });

  it("401s when there is no session (userId never comes from state)", async () => {
    getSessionUserId.mockResolvedValue(null);
    const res = await GET(
      callbackReq(
        { code: "c", state: "n1" },
        { dtr_connect_nonce: "n1" }
      ),
      ctx
    );
    expect(res.status).toBe(401);
    // The one-shot nonce must be cleared even on a failure path, not just success.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("dtr_connect_nonce=");
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it("400s when the nonce cookie is absent", async () => {
    const res = await GET(
      callbackReq({ code: "c", state: "n1" }, {}),
      ctx
    );
    expect(res.status).toBe(400);
  });

  it("400s when the state nonce doesn't match the cookie", async () => {
    const res = await GET(
      callbackReq(
        { code: "c", state: "n1" },
        { dtr_connect_nonce: "n2" }
      ),
      ctx
    );
    expect(res.status).toBe(400);
  });

  it("passes the CSRF guard when nonce matches (reaches server lookup)", async () => {
    const res = await GET(
      callbackReq(
        { code: "c", state: "n1" },
        { dtr_connect_nonce: "n1" }
      ),
      ctx
    );
    // Server lookup returns [] → 404, proving the request got past the auth +
    // nonce guards rather than being rejected at them.
    expect(res.status).toBe(404);
  });
});
