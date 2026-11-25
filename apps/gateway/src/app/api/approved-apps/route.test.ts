import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/** The two routes behind the Connections page's "Apps you approved": a
 * session-gated list and a session-gated remove. What the helper and the
 * listing do to rows is pinned on real Postgres in
 * `gateway/oauth/approved-apps.db.test.ts`; this pins the gate, the id
 * check, whose rows are named, and that an unknown client reads like a
 * removed one. */

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({ getSessionUserId: () => getSessionUserId() }));
vi.mock("@/lib/db", () => ({ db: { marker: "db" } }));

const listApprovedApps = vi.fn();
vi.mock("@/gateway/oauth/approved-apps", () => ({
  listApprovedApps: (...args: unknown[]) => listApprovedApps(...args),
}));
const endGrantForClient = vi.fn();
vi.mock("@/gateway/oauth/grants", async (orig) => ({
  ...(await orig<typeof import("@/gateway/oauth/grants")>()),
  endGrantForClient: (...args: unknown[]) => endGrantForClient(...args),
}));
const trackApprovedAppRemoved = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/gateway/track", () => ({
  trackApprovedAppRemoved: (...args: unknown[]) => trackApprovedAppRemoved(...args),
}));

import { DELETE, GET } from "./route";

const CLIENT = "6b1f0c1e-3c1b-4a53-9a55-0d9a2f6f7f10";
const ended = (removed: boolean) => ({
  removed,
  refreshTokensRevoked: removed ? 1 : 0,
  accessTokensRevoked: removed ? 1 : 0,
  codesInvalidated: 0,
  approvalRemoved: removed,
  sessionsClosed: removed ? 1 : 0,
});

function request(query = ""): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/approved-apps${query}`) } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionUserId.mockResolvedValue("user-1");
  listApprovedApps.mockResolvedValue([]);
  endGrantForClient.mockResolvedValue(ended(true));
});

describe("GET /api/approved-apps", () => {
  it("refuses a signed-out caller and reads nothing", async () => {
    getSessionUserId.mockResolvedValue(null);
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(listApprovedApps).not.toHaveBeenCalled();
  });

  it("lists the signed-in user's apps and nobody else's", async () => {
    const app = { clientId: CLIENT, name: "Claude", redirectHosts: ["claude.ai"], approvedAt: null, lastTokenAt: null };
    listApprovedApps.mockResolvedValue([app]);
    const res = await GET(request("?userId=someone-else"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ apps: [app] });
    expect(listApprovedApps).toHaveBeenCalledWith({ marker: "db" }, "user-1");
  });
});

describe("DELETE /api/approved-apps", () => {
  it("refuses a signed-out caller and removes nothing", async () => {
    getSessionUserId.mockResolvedValue(null);
    const res = await DELETE(request(`?clientId=${CLIENT}`));
    expect(res.status).toBe(401);
    expect(endGrantForClient).not.toHaveBeenCalled();
  });

  it("ends the signed-in user's grant to that client and records it once", async () => {
    const res = await DELETE(request(`?clientId=${CLIENT}&userId=someone-else`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(endGrantForClient).toHaveBeenCalledTimes(1);
    expect(endGrantForClient).toHaveBeenCalledWith({ marker: "db" }, "user-1", CLIENT);
    expect(trackApprovedAppRemoved).toHaveBeenCalledTimes(1);
    expect(trackApprovedAppRemoved).toHaveBeenCalledWith({ marker: "db" }, "user-1", CLIENT);
  });

  it("answers an unknown or already removed client with the same success, and records nothing", async () => {
    endGrantForClient.mockResolvedValue(ended(false));
    const res = await DELETE(request(`?clientId=${CLIENT}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(trackApprovedAppRemoved).not.toHaveBeenCalled();
  });

  it("refuses anything that is not a client id before the helper is reached", async () => {
    for (const query of ["", "?clientId=", "?clientId=web", "?clientId=datatorag-agent", "?clientId=%27%20OR%201%3D1", `?clientId=${CLIENT}x`]) {
      const res = await DELETE(request(query));
      expect(res.status, query).toBe(400);
    }
    expect(endGrantForClient).not.toHaveBeenCalled();
  });

  it("the helper's refusal of an internal client id is a 400, never a 500", async () => {
    const { InternalClientError } = await import("@/gateway/oauth/grants");
    endGrantForClient.mockRejectedValue(new InternalClientError());
    const res = await DELETE(request(`?clientId=${CLIENT}`));
    expect(res.status).toBe(400);
    expect(trackApprovedAppRemoved).not.toHaveBeenCalled();
  });

  it("a failed removal is a generic 500 with no detail", async () => {
    endGrantForClient.mockRejectedValue(new Error("relation oauth_consents exploded"));
    const res = await DELETE(request(`?clientId=${CLIENT}`));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("oauth_consents");
  });
});
