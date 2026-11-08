import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/** Disconnect must tell Google before deleting our rows — best effort: a
 * revoke failure still disconnects locally, and the whole-service path
 * revokes every row's token, not just the first. Unless another user holds
 * the same Google account (SCRUM-180): their tokens are the same grant, so
 * only our rows go and the answer says so. */

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
  // `returning` included: drizzle's delete/update expose it, and a stub that
  // omits a real method makes production code fail here for a reason that does
  // not exist in production.
  for (const m of ["from", "where", "leftJoin", "orderBy", "limit", "returning"]) {
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
import { sealedColumns } from "@/gateway/token-crypto";

/** A token row as the disconnect reads it: sealed (SCRUM-442), bound to the
 * session user and the row. */
function sealed(rowId: string, accessToken: string | null, refreshToken: string | null) {
  return { id: rowId, ...sealedColumns("service_connections", { userId: "user-1", rowId }, { accessToken, refreshToken }) };
}

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
  const ACCOUNT = {
    id: "acct-1",
    serviceConnectionId: "conn-1",
    connectorType: "google-workspace",
    isDefault: false,
    accountEmail: "shared@example.com",
    externalAccountId: null,
  };

  function primeAccount(otherHolders: unknown[] = []) {
    // disconnectAccount's account lookup, its other-holder check, then its
    // token lookup.
    selectResults.push([ACCOUNT]);
    selectResults.push(otherHolders);
    selectResults.push([sealed("conn-1", "access-1", "refresh-1")]);
  }

  it("another user holds the same account: deletes ours, leaves the grant, and says so", async () => {
    primeAccount([{ id: "acct-of-user-2" }]);

    const res = await DELETE(request("accountId=acct-1"));

    expect(res.status).toBe(200);
    expect(revokeGoogleToken).not.toHaveBeenCalled();
    expect(deleteCalls.length).toBeGreaterThan(0);
    expect(await res.json()).toEqual({
      ok: true,
      note: "Disconnected here. Another DataToRAG user still holds this account, so its Google Workspace access was not revoked.",
    });
  });

  it("the last holder: revokes, and the answer carries no note", async () => {
    primeAccount();

    const res = await DELETE(request("accountId=acct-1"));

    expect(revokeGoogleToken).toHaveBeenCalledOnce();
    expect(await res.json()).toEqual({ ok: true });
  });

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
    selectResults.push([ACCOUNT]);
    selectResults.push([]);
    selectResults.push([sealed("conn-1", "access-1", null)]);

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
  it("skips the revoke only for the account another user holds", async () => {
    selectResults.push([
      { ...sealed("conn-1", "a-1", "r-1"), accountEmail: "shared@example.com", externalAccountId: null },
      { ...sealed("conn-2", "a-2", "r-2"), accountEmail: "mine@example.com", externalAccountId: null },
    ]);
    // The other-holder checks, one per row, in row order.
    selectResults.push([{ id: "acct-of-user-2" }]);
    selectResults.push([]);

    const res = await DELETE(request("service=google-workspace"));

    expect(revokeGoogleToken).toHaveBeenCalledExactlyOnceWith("r-2");
    expect(deleteCalls).toHaveLength(2);
    expect((await res.json()).note).toMatch(/^Disconnected here\. Another DataToRAG user still holds this account/);
  });

  it("revokes every row's token before deleting", async () => {
    selectResults.push([
      sealed("conn-1", "a-1", "r-1"),
      sealed("conn-2", "a-2", null),
      sealed("conn-3", null, null),
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
