/**
 * SCRUM-442: re-encrypt, against real Postgres. SCRUM-505 removed `backfill`
 * and `restore`, the two commands that read and wrote the plain token
 * columns; the command line now refuses both by name.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { serviceConnections, type Database } from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import { reencryptSealed, runTokenCommand } from "./token-crypto-commands";
import { openToken, sealToken, sealedKeyId, type SealContext } from "./token-crypto";

const keyA = `a:${randomBytes(32).toString("base64")}`;
const keyB = `b:${randomBytes(32).toString("base64")}`;

describe.skipIf(!isDockerAvailable())("SCRUM-442: token commands", () => {
  let db: Database;
  const savedKeys = process.env.CONNECTION_TOKEN_KEYS;

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    process.env.CONNECTION_TOKEN_KEYS = savedKeys;
    await stopTestDb();
  });

  beforeEach(async () => {
    process.env.CONNECTION_TOKEN_KEYS = keyA;
    await db.delete(serviceConnections);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const at = (userId: string, rowId: string, column: SealContext["column"]): SealContext => ({
    table: "service_connections",
    column,
    userId,
    rowId,
  });

  /** A service_connections row as the gateway writes one: sealed only. */
  async function row(tokens: { access: string; refresh?: string | null }) {
    const userId = await insertTestUser(db);
    const id = randomUUID();
    await db.insert(serviceConnections).values({
      id,
      userId,
      service: "google-workspace",
      accessTokenSealed: sealToken(tokens.access, at(userId, id, "access_token")),
      refreshTokenSealed: tokens.refresh ? sealToken(tokens.refresh, at(userId, id, "refresh_token")) : null,
    });
    return { id, userId };
  }

  async function read(id: string) {
    const [r] = await db
      .select({ accessTokenSealed: serviceConnections.accessTokenSealed, refreshTokenSealed: serviceConnections.refreshTokenSealed })
      .from(serviceConnections)
      .where(eq(serviceConnections.id, id));
    return r;
  }

  describe("re-encrypt", () => {
    it("re-seals every value under an old key with the first key, and leaves current ones", async () => {
      const a = await row({ access: "at-1", refresh: "rt-1" });

      process.env.CONNECTION_TOKEN_KEYS = `${keyB},${keyA}`;
      const b = await row({ access: "at-2" });
      const bSealed = (await read(b.id)).accessTokenSealed;

      expect(await reencryptSealed(db)).toEqual({ resealed: 2, skipped: 0, failed: 0 });
      const ra = await read(a.id);
      expect(sealedKeyId(ra.accessTokenSealed!)).toBe("b");
      expect(sealedKeyId(ra.refreshTokenSealed!)).toBe("b");
      expect(openToken(ra.refreshTokenSealed!, at(a.userId, a.id, "refresh_token"))).toBe("rt-1");
      expect((await read(b.id)).accessTokenSealed).toBe(bSealed);

      // Once nothing carries `a`, it can leave the list.
      process.env.CONNECTION_TOKEN_KEYS = keyB;
      expect(openToken(ra.accessTokenSealed!, at(a.userId, a.id, "access_token"))).toBe("at-1");
      expect(await reencryptSealed(db)).toEqual({ resealed: 0, skipped: 0, failed: 0 });
    });
  });

  describe("the command line", () => {
    it("prints counts only, and refuses the plain-column commands by name", async () => {
      await row({ access: "at-secret-1", refresh: "rt-secret-1" });
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));
      vi.spyOn(console, "error").mockImplementation((...a) => void lines.push(a.join(" ")));

      expect(await runTokenCommand(db, "reencrypt")).toBe(0);
      // SCRUM-505: gone, so a runbook that still names them fails loudly.
      expect(await runTokenCommand(db, "backfill")).toBe(2);
      expect(await runTokenCommand(db, "restore")).toBe(2);
      expect(await runTokenCommand(db, "nonsense")).toBe(2);

      const stored = await db.execute(sql`select access_token_sealed as s from service_connections`);
      const sealed = String((stored as unknown as Array<{ s: string }>)[0].s);
      const out = lines.join("\n");
      expect(out).toMatch(/reencrypt: resealed=0 skipped=0 failed=0/);
      expect(out).toMatch(/usage: node dist\/tokens\.js reencrypt \| hash-access-tokens/);
      for (const secret of ["at-secret-1", "rt-secret-1", sealed, sealed.split(".")[3]]) {
        expect(out).not.toContain(secret);
      }
    });
  });
});
