/**
 * The key's life cycle against a real Postgres (SCRUM-245), and the proof
 * that a FRESH database has the api_keys table at all: production got it by
 * hand years ago and no migration created it until 0017, so this suite runs
 * the real migrations folder into an empty container and then mints, uses,
 * revokes and is refused.
 *
 * Gated on a Docker daemon the way the liveness suite is; skipped, not
 * failed, where there is none.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "../test-utils/db";

const dockerAvailable = isDockerAvailable();

describe.skipIf(!dockerAvailable)("api keys against a fresh database (SCRUM-245)", () => {
  let db: Database;
  let userId: string;
  let bearer: typeof import("./bearer-auth");

  beforeAll(async () => {
    db = await getTestDb();
    userId = await insertTestUser(db);
    bearer = await import("./bearer-auth");
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  it("has the table after the migrations run, with the unique hash and the owner cascade", async () => {
    const cols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_keys' ORDER BY ordinal_position
    `);
    expect(cols.map((c) => c.column_name)).toEqual([
      "id", "user_id", "name", "key_hash", "key_prefix", "last_used_at", "expires_at", "revoked_at", "created_at",
    ]);
    const cons = await db.execute(sql`
      SELECT conname FROM pg_constraint WHERE conrelid = 'public.api_keys'::regclass AND contype IN ('u', 'f') ORDER BY conname
    `);
    expect(cons.map((c) => c.conname)).toEqual(["api_keys_key_hash_unique", "api_keys_user_id_users_id_fk"]);
  });

  it("mints, authenticates, lists, revokes, and then refuses", async () => {
    const made = await bearer.createApiKey(db, userId, "fresh env harness");
    expect(made.ok).toBe(true);
    if (!made.ok) return;

    const live = await bearer.resolveBearer(db, made.rawKey);
    expect(live).toMatchObject({ ok: true, userId, authKind: "api_key", keyId: made.key.id });

    await bearer.touchApiKey(db, made.key.id);
    const listed = await bearer.listApiKeys(db, userId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: made.key.id, name: "fresh env harness", revoked: false });
    expect(listed[0]!.lastUsedAt).toBeInstanceOf(Date);

    expect(await bearer.revokeApiKey(db, userId, made.key.id)).toBe(true);
    expect(await bearer.revokeApiKey(db, userId, made.key.id)).toBe(false);
    expect(await bearer.resolveBearer(db, made.rawKey)).toEqual({ ok: false, reason: "revoked", userId });

    // Someone else's key id changes nothing for this user.
    const other = await insertTestUser(db);
    const theirs = await bearer.createApiKey(db, other, "theirs");
    if (!theirs.ok) throw new Error("mint failed");
    expect(await bearer.revokeApiKey(db, userId, theirs.key.id)).toBe(false);
    expect(await bearer.resolveBearer(db, theirs.rawKey)).toMatchObject({ ok: true, userId: other });
  });

  it("stops at ten live keys, and a revoked one frees a slot", async () => {
    const holder = await insertTestUser(db);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const made = await bearer.createApiKey(db, holder, `key ${i}`);
      if (!made.ok) throw new Error(`mint ${i} failed`);
      ids.push(made.key.id);
    }
    expect(await bearer.createApiKey(db, holder, "eleventh")).toEqual({ ok: false, reason: "too_many" });
    expect(await bearer.revokeApiKey(db, holder, ids[0]!)).toBe(true);
    expect((await bearer.createApiKey(db, holder, "eleventh")).ok).toBe(true);
  });
});
