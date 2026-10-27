/**
 * SCRUM-443 release 2: the backfill that fills `token_hash` for every live
 * access token issued before release 1, run as
 * `node dist/tokens.js hash-access-tokens`. Real Postgres, because the
 * guarded UPDATE and the live-row selection are the whole of it.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens } from "@datatorag-mcp/db";
import { hashToken } from "@datatorag-mcp/auth";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "@/test-utils/db";
import { backfillAccessTokenHashes, countUnhashedLive } from "./access-token-hash-commands";
import { runTokenCommand } from "./token-crypto-commands";

const dockerAvailable = isDockerAvailable();
let db: Database;
const HOUR = 3600_000;

async function token(userId: string, opts: { expiresIn?: number; revoked?: boolean; hashed?: boolean } = {}) {
  const raw = `tok-${randomUUID()}`;
  await db.insert(oauthAccessTokens).values({
    token: raw,
    tokenHash: opts.hashed ? hashToken(raw) : null,
    clientId: "client-xyz",
    userId,
    scope: null,
    expiresAt: new Date(Date.now() + (opts.expiresIn ?? 24 * HOUR)),
    revokedAt: opts.revoked ? new Date() : null,
  });
  return raw;
}

async function hashOf(raw: string) {
  const [row] = await db
    .select({ h: oauthAccessTokens.tokenHash })
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.token, raw));
  return row.h;
}

describe.skipIf(!dockerAvailable)("hash-access-tokens (real db)", () => {
  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);
  afterAll(async () => {
    await stopTestDb();
  });
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM oauth_access_tokens`);
  });

  it("hashes every live token with no hash, exactly as hashToken does, and leaves the rest alone", async () => {
    const userId = await insertTestUser(db);
    const live = await token(userId);
    const revoked = await token(userId, { revoked: true });
    const expired = await token(userId, { expiresIn: -HOUR });
    const already = await token(userId, { hashed: true });

    expect(await backfillAccessTokenHashes(db)).toEqual({ hashed: 1, skipped: 0, unhashed: 0 });
    expect(await hashOf(live)).toBe(hashToken(live));
    expect(await hashOf(revoked)).toBeNull();
    expect(await hashOf(expired)).toBeNull();
    expect(await hashOf(already)).toBe(hashToken(already));
  });

  it("is idempotent: a second run finds nothing", async () => {
    const userId = await insertTestUser(db);
    await token(userId);
    await backfillAccessTokenHashes(db);
    expect(await backfillAccessTokenHashes(db)).toEqual({ hashed: 0, skipped: 0, unhashed: 0 });
  });

  it("a hash written while it runs wins, and is counted as skipped", async () => {
    const userId = await insertTestUser(db);
    const raw = await token(userId);
    const result = await backfillAccessTokenHashes(db, {
      afterRead: async () => {
        await db.update(oauthAccessTokens).set({ tokenHash: "written-meanwhile" }).where(eq(oauthAccessTokens.token, raw));
      },
    });
    expect(result).toEqual({ hashed: 0, skipped: 1, unhashed: 0 });
    expect(await hashOf(raw)).toBe("written-meanwhile");
  });

  it("reports a live token left without a hash, which the command's exit code gates on", async () => {
    const userId = await insertTestUser(db);
    const result = await backfillAccessTokenHashes(db, {
      afterRead: async () => {
        await token(userId);
      },
    });
    expect(result.unhashed).toBe(1);
    expect(await countUnhashedLive(db)).toBe(1);
  });

  it("the command prints counts only, and exits 0 once every live token has a hash", async () => {
    const userId = await insertTestUser(db);
    const raw = await token(userId);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runTokenCommand(db, "hash-access-tokens")).toBe(0);
      expect(log).toHaveBeenCalledWith("hash-access-tokens: hashed=1 skipped=0 unhashed=0");
      const printed = log.mock.calls.flat().join("\n");
      expect(printed).not.toContain(raw);
      expect(printed).not.toContain(hashToken(raw));
    } finally {
      log.mockRestore();
    }
  });
});
