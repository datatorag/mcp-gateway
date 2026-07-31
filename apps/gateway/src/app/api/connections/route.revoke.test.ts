import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/** Disconnect must tell Google before deleting our rows — best effort: a
 * revoke failure still disconnects locally, and the whole-service path
 * revokes every row's token, not just the first. */

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({
  getSessionUserId: () => getSessionUserId(),
}));

const revokeGoogleToken = vi.fn();
vi.mock("@/lib/google-revoke", () => ({
  revokeGoogleToken: (token: string) => revokeGoogleToken(token),
}));

const selectResults: unknown[] = [];
const deleteCalls: unknown[] = [];
function chainable(result: unknown) {
  const p = Promise.resolve(result) as Promise<unknown> & Record<string, unknown>;
  for (const m of ["from", "where", "leftJoin", "orderBy", "limit"]) {
    p[m] = () => p;
  }
  return p;
}
const tx = {
  delete: (table: unknown) => {
    deleteCalls.push(table);
    return chainable([]);
  },
  update: () => {
    const c = chainable([]) as Record<string, unknown>;
    c.set = () => c;
    return c;
  },
  select: () => chainable(selectResults.shift() ?? []),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: () => chainable(selectResults.shift() ?? []),
    delete: (table: unknown) => {
      deleteCalls.push(table);
      return chainable([]);
    },
    transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
  },
}));

import { DELETE } from "./route";

function request(query: string): NextRequest {
  return {
    nextUrl: new URL(`http://localhost/api/connections?${query}`),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.length = 0;
  deleteCalls.length = 0;
  getSessionUserId.mockResolvedValue("user-1");
  revokeGoogleToken.mockResolvedValue(true);
});

describe("DELETE ?accountId= (single account)", () => {
  function primeAccount() {
    // disconnectAccount's account lookup, then its token lookup.
    selectResults.push([
      {
        id: "acct-1",
        serviceConnectionId: "conn-1",
        connectorType: "google-workspace",
        isDefault: false,
      },
    ]);
    selectResults.push([
      { accessToken: "access-1", refreshToken: "refresh-1" },
    ]);
  }

  it("revokes the refresh token, then deletes", async () => {
    primeAccount();

    const res = await DELETE(request("accountId=acct-1"));

    expect(res.status).toBe(200);
    expect(revokeGoogleToken).toHaveBeenCalledExactlyOnceWith("refresh-1");
    expect(deleteCalls.length).toBeGreaterThan(0);
  });

  it("still deletes locally when the revoke fails", async () => {
    primeAccount();
    revokeGoogleToken.mockResolvedValue(false);

    const res = await DELETE(request("accountId=acct-1"));

    expect(res.status).toBe(200);
    expect(deleteCalls.length).toBeGreaterThan(0);
  });

  it("falls back to the access token when no refresh token exists", async () => {
    selectResults.push([
      {
        id: "acct-1",
        serviceConnectionId: "conn-1",
        connectorType: "google-workspace",
        isDefault: false,
      },
    ]);
    selectResults.push([{ accessToken: "access-1", refreshToken: null }]);

    await DELETE(request("accountId=acct-1"));

    expect(revokeGoogleToken).toHaveBeenCalledExactlyOnceWith("access-1");
  });

  it("does not revoke for non-Google connectors", async () => {
    selectResults.push([
      {
        id: "acct-1",
        serviceConnectionId: "conn-1",
        connectorType: "atlassian",
        isDefault: false,
      },
    ]);

    await DELETE(request("accountId=acct-1"));

    expect(revokeGoogleToken).not.toHaveBeenCalled();
  });
});

describe("DELETE ?service= (whole service)", () => {
  it("revokes every row's token before deleting", async () => {
    selectResults.push([
      { accessToken: "a-1", refreshToken: "r-1" },
      { accessToken: "a-2", refreshToken: null },
      { accessToken: null, refreshToken: null },
    ]);

    const res = await DELETE(request("service=google-workspace"));

    expect(res.status).toBe(200);
    expect(revokeGoogleToken).toHaveBeenCalledTimes(2);
    expect(revokeGoogleToken).toHaveBeenCalledWith("r-1");
    expect(revokeGoogleToken).toHaveBeenCalledWith("a-2");
    expect(deleteCalls).toHaveLength(2); // connected_accounts + service_connections
  });

  it("does not revoke for non-Google services", async () => {
    const res = await DELETE(request("service=atlassian"));

    expect(res.status).toBe(200);
    expect(revokeGoogleToken).not.toHaveBeenCalled();
    expect(deleteCalls).toHaveLength(2);
  });
});
