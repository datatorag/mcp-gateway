/**
 * A machine credential that does not rotate (SCRUM-245).
 *
 * OAuth refresh tokens are single-use here, so a CLI that does not persist
 * the rotated token dies at its first refresh. An API key is the product
 * answer: minted by the account holder, scoped to one user, revocable, shown
 * once, and accepted as a bearer on /mcp exactly like an access token, with
 * no refresh and no rotation. The four claims the ticket names are pinned
 * below, plus the shape of the key's own life cycle.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { hashApiKey } from "@datatorag-mcp/auth";

type Row = Record<string, unknown>;
const selectResults: Row[][] = [];
const inserted: Row[] = [];
const updates: Array<{ set: Row }> = [];
const updateResults: Row[][] = [];

function chainable(result: unknown) {
  const p = Promise.resolve(result) as Promise<unknown> & Record<string, unknown>;
  for (const m of ["from", "where", "leftJoin", "orderBy", "limit"]) p[m] = () => p;
  return p;
}
const db = {
  select: () => chainable(selectResults.shift() ?? []),
  insert: () => ({
    values: (v: Row) => {
      inserted.push(v);
      return { returning: async () => [{ id: "key-1", createdAt: new Date("2026-09-11T00:00:00Z"), ...v }] };
    },
  }),
  update: () => ({
    set: (set: Row) => {
      updates.push({ set });
      return { where: () => ({ returning: async () => updateResults.shift() ?? [] }) };
    },
  }),
} as unknown as Database;

const {
  API_KEY_CLIENT_ID,
  createApiKey,
  isApiKeyShaped,
  listApiKeys,
  resolveBearer,
  revokeApiKey,
} = await import("./bearer-auth");

const LIVE = { revokedAt: null, expiresAt: null };

beforeEach(() => {
  selectResults.length = 0;
  inserted.length = 0;
  updates.length = 0;
  updateResults.length = 0;
});

describe("minting a key (SCRUM-245)", () => {
  it("returns the raw key once, stores only its hash and a short prefix", async () => {
    selectResults.push([{ n: 0 }]);
    const made = await createApiKey(db, "user-1", "smoke harness");
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.rawKey.startsWith("sk-dtrmcp_")).toBe(true);
    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row.keyHash).toBe(hashApiKey(made.rawKey));
    expect(row.keyPrefix).toBe(made.rawKey.slice(0, 14));
    expect(JSON.stringify(row)).not.toContain(made.rawKey);
    expect(made.key).toMatchObject({ id: "key-1", name: "smoke harness", prefix: made.rawKey.slice(0, 14) });
    expect("rawKey" in made.key).toBe(false);
  });

  it("refuses a blank or overlong name, and an eleventh live key", async () => {
    expect(await createApiKey(db, "user-1", "   ")).toMatchObject({ ok: false, reason: "invalid_name" });
    expect(await createApiKey(db, "user-1", "x".repeat(61))).toMatchObject({ ok: false, reason: "invalid_name" });
    selectResults.push([{ n: 10 }]);
    expect(await createApiKey(db, "user-1", "one more")).toMatchObject({ ok: false, reason: "too_many" });
    expect(inserted).toHaveLength(0);
  });
});

describe("a key as a bearer (SCRUM-245)", () => {
  it("authenticates like an access token, with its own client id and auth kind", async () => {
    selectResults.push([{ id: "key-1", userId: "user-1", ...LIVE }]);
    const auth = await resolveBearer(db, "sk-dtrmcp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF");
    expect(auth).toEqual({ ok: true, userId: "user-1", clientId: API_KEY_CLIENT_ID, authKind: "api_key", keyId: "key-1" });
  });

  it("refuses a revoked key, naming the owner so the failure attributes", async () => {
    selectResults.push([{ id: "key-1", userId: "user-1", revokedAt: new Date("2026-09-10T00:00:00Z"), expiresAt: null }]);
    const auth = await resolveBearer(db, "sk-dtrmcp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF");
    expect(auth).toEqual({ ok: false, reason: "revoked", userId: "user-1" });
  });

  it("refuses an expired key and a key nothing was ever minted for", async () => {
    selectResults.push([{ id: "key-1", userId: "user-1", revokedAt: null, expiresAt: new Date("2026-01-01T00:00:00Z") }]);
    expect(await resolveBearer(db, "sk-dtrmcp_expired00000000000000000000000000000000")).toEqual({
      ok: false, reason: "expired", userId: "user-1",
    });
    selectResults.push([]);
    expect(await resolveBearer(db, "sk-dtrmcp_never000000000000000000000000000000000000")).toEqual({
      ok: false, reason: "invalid", userId: null,
    });
  });

  it("leaves an OAuth session exactly as it was", async () => {
    // Not key-shaped: the OAuth row is consulted and its own client id and
    // liveness rule decide, with auth kind oauth.
    selectResults.push([{ userId: "user-2", clientId: "client-xyz", ...LIVE }]);
    expect(await resolveBearer(db, "opaque-oauth-access-token")).toEqual({
      ok: true, userId: "user-2", clientId: "client-xyz", authKind: "oauth",
    });
    selectResults.push([{ userId: "user-2", clientId: "client-xyz", revokedAt: null, expiresAt: new Date("2026-01-01T00:00:00Z") }]);
    expect(await resolveBearer(db, "opaque-oauth-access-token")).toEqual({
      ok: false, reason: "expired", userId: "user-2",
    });
    expect(isApiKeyShaped("opaque-oauth-access-token")).toBe(false);
    expect(isApiKeyShaped("sk-dtrmcp_x")).toBe(true);
  });

  it("never lets the key reach a log line", async () => {
    const raw = "sk-dtrmcp_secretsecretsecretsecretsecretsecret0000";
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map((s) =>
      s.mockImplementation(() => {})
    );
    try {
      selectResults.push([{ id: "key-1", userId: "user-1", ...LIVE }]);
      await resolveBearer(db, raw);
      selectResults.push([]);
      await resolveBearer(db, raw);
      selectResults.push([{ n: 0 }]);
      await createApiKey(db, "user-1", "harness");
      const everything = spies.flatMap((s) => s.mock.calls.flat()).map(String).join("\n");
      expect(everything).not.toContain(raw);
      expect(everything).not.toContain("sk-dtrmcp_");
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

describe("listing and revoking (SCRUM-245)", () => {
  it("lists the user's keys without any hash, newest first as stored", async () => {
    selectResults.push([
      { id: "key-2", name: "b", keyPrefix: "sk-dtrmcp_bbbb", createdAt: new Date(), lastUsedAt: null, expiresAt: null, revokedAt: null },
    ]);
    const keys = await listApiKeys(db, "user-1");
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ id: "key-2", name: "b", prefix: "sk-dtrmcp_bbbb", revoked: false });
    expect(JSON.stringify(keys)).not.toContain("keyHash");
  });

  it("revokes only the caller's own key, once", async () => {
    updateResults.push([{ id: "key-1" }]);
    expect(await revokeApiKey(db, "user-1", "key-1")).toBe(true);
    expect(updates[0]!.set.revokedAt).toBeInstanceOf(Date);
    // Foreign or already revoked: the guarded update matches nothing.
    updateResults.push([]);
    expect(await revokeApiKey(db, "user-1", "key-9")).toBe(false);
  });
});
