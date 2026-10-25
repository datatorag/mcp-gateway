/**
 * SCRUM-442: backfill, re-encrypt and restore, against real Postgres.
 *
 * The backfill's exit code is the gate before reads move to the sealed
 * columns: it must stay non-zero while any token is held only in plain text,
 * and it must never overwrite a write that landed while it ran.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  mcpServers,
  pluginConnections,
  serviceConnections,
  type Database,
} from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "../test-utils/db";
import {
  backfillSealed,
  countUnsealed,
  reencryptSealed,
  restorePlaintext,
  runTokenCommand,
} from "./token-crypto-commands";
import { openToken, sealToken, sealedKeyId, type SealContext } from "./token-crypto";

const keyA = `a:${randomBytes(32).toString("base64")}`;
const keyB = `b:${randomBytes(32).toString("base64")}`;

describe.skipIf(!isDockerAvailable())("SCRUM-442: token commands", () => {
  let db: Database;
  const savedKeys = process.env.CONNECTION_TOKEN_KEYS;

  beforeAll(async () => {
    db = await getTestDb();
    // Restore exists for release 3, after migration A has let the plain
    // access token be null. This container gets that one change so a row
    // written sealed-only can be built here.
    await db.execute(sql`ALTER TABLE service_connections ALTER COLUMN access_token DROP NOT NULL`);
  }, 120_000);

  afterAll(async () => {
    process.env.CONNECTION_TOKEN_KEYS = savedKeys;
    await stopTestDb();
  });

  beforeEach(async () => {
    process.env.CONNECTION_TOKEN_KEYS = keyA;
    await db.delete(serviceConnections);
    await db.delete(pluginConnections);
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

  /** A service_connections row with whatever columns the case needs. */
  async function row(values: {
    accessToken?: string | null;
    refreshToken?: string | null;
    accessTokenSealed?: string | null;
    refreshTokenSealed?: string | null;
  }) {
    const userId = await insertTestUser(db);
    const id = randomUUID();
    await db.insert(serviceConnections).values({
      id,
      userId,
      service: "google-workspace",
      accessToken: "placeholder",
      ...values,
    } as typeof serviceConnections.$inferInsert);
    return { id, userId };
  }

  async function read(id: string) {
    const [r] = await db.select().from(serviceConnections).where(eq(serviceConnections.id, id));
    return r;
  }

  describe("backfill", () => {
    it("seals every plain token into its empty sealed column, and a second run finds nothing", async () => {
      const a = await row({ accessToken: "at-1", refreshToken: "rt-1" });
      const b = await row({ accessToken: "at-2", refreshToken: null });

      expect(await backfillSealed(db)).toEqual({ sealed: 3, skipped: 0, unsealed: 0 });
      const ra = await read(a.id);
      expect(openToken(ra.accessTokenSealed!, at(a.userId, a.id, "access_token"))).toBe("at-1");
      expect(openToken(ra.refreshTokenSealed!, at(a.userId, a.id, "refresh_token"))).toBe("rt-1");
      expect((await read(b.id)).refreshTokenSealed).toBeNull();

      expect(await backfillSealed(db)).toEqual({ sealed: 0, skipped: 0, unsealed: 0 });
    });

    it("seals the other column of a row a refresh sealed only half of", async () => {
      // A Google refresh writes the access token alone, sealed. The refresh
      // token beside it is still plain.
      const userId = await insertTestUser(db);
      const id = randomUUID();
      await db.insert(serviceConnections).values({
        id,
        userId,
        service: "google-workspace",
        accessToken: "at-new",
        accessTokenSealed: sealToken("at-new", at(userId, id, "access_token")),
        refreshToken: "rt-1",
      });
      expect(await backfillSealed(db)).toEqual({ sealed: 1, skipped: 0, unsealed: 0 });
      const r = await read(id);
      expect(openToken(r.refreshTokenSealed!, at(userId, id, "refresh_token"))).toBe("rt-1");
      expect(openToken(r.accessTokenSealed!, at(userId, id, "access_token"))).toBe("at-new");
    });

    it("loses to a write that changed the token after it was read, and exits non-zero until the next run", async () => {
      const a = await row({ accessToken: "at-1", refreshToken: null });
      const result = await backfillSealed(db, {
        afterRead: async () => {
          // A reconnect lands between the read and the update, written the
          // way an image from before release 1 writes it: plain only.
          await db.update(serviceConnections).set({ accessToken: "at-reconnected" }).where(eq(serviceConnections.id, a.id));
        },
      });
      expect(result).toEqual({ sealed: 0, skipped: 1, unsealed: 1 });
      expect((await read(a.id)).accessTokenSealed).toBeNull();

      expect(await backfillSealed(db)).toEqual({ sealed: 1, skipped: 0, unsealed: 0 });
      expect(openToken((await read(a.id)).accessTokenSealed!, at(a.userId, a.id, "access_token"))).toBe("at-reconnected");
    });

    it("leaves alone a row a concurrent write already sealed", async () => {
      const a = await row({ accessToken: "at-1", refreshToken: null });
      const theirs = sealToken("at-1", at(a.userId, a.id, "access_token"));
      const result = await backfillSealed(db, {
        afterRead: async () => {
          await db.update(serviceConnections).set({ accessTokenSealed: theirs }).where(eq(serviceConnections.id, a.id));
        },
      });
      expect(result).toEqual({ sealed: 0, skipped: 1, unsealed: 0 });
      expect((await read(a.id)).accessTokenSealed).toBe(theirs);
    });

    it("counts a refresh token held only in plain text as unsealed", async () => {
      await row({ accessToken: null, accessTokenSealed: "x", refreshToken: "rt-1" });
      expect(await countUnsealed(db)).toBe(1);
    });
  });

  describe("re-encrypt", () => {
    it("re-seals every value under an old key with the first key, in both tables, and leaves current ones", async () => {
      const a = await row({ accessToken: "at-1", refreshToken: "rt-1" });
      await backfillSealed(db);
      const userId = await insertTestUser(db);
      const [server] = await db.insert(mcpServers).values({ slug: `s-${randomUUID()}`, name: "S" }).returning({ id: mcpServers.id });
      const pluginId = randomUUID();
      const pluginCtx: SealContext = { table: "plugin_connections", column: "access_token", userId, rowId: pluginId };
      await db.insert(pluginConnections).values({
        id: pluginId,
        userId,
        mcpServerId: server.id,
        provider: "p",
        accessTokenSealed: sealToken("pat-1", pluginCtx),
      });

      process.env.CONNECTION_TOKEN_KEYS = `${keyB},${keyA}`;
      const b = await row({ accessToken: "at-2", refreshToken: null });
      await backfillSealed(db);
      const bSealed = (await read(b.id)).accessTokenSealed;

      expect(await reencryptSealed(db)).toEqual({ resealed: 3, skipped: 0, failed: 0 });
      const ra = await read(a.id);
      expect(sealedKeyId(ra.accessTokenSealed!)).toBe("b");
      expect(sealedKeyId(ra.refreshTokenSealed!)).toBe("b");
      expect(openToken(ra.refreshTokenSealed!, at(a.userId, a.id, "refresh_token"))).toBe("rt-1");
      expect((await read(b.id)).accessTokenSealed).toBe(bSealed);
      const [p] = await db.select().from(pluginConnections).where(eq(pluginConnections.id, pluginId));
      expect(sealedKeyId(p.accessTokenSealed!)).toBe("b");

      // Once nothing carries `a`, it can leave the list.
      process.env.CONNECTION_TOKEN_KEYS = keyB;
      expect(openToken(p.accessTokenSealed!, pluginCtx)).toBe("pat-1");
      expect(await reencryptSealed(db)).toEqual({ resealed: 0, skipped: 0, failed: 0 });
    });
  });

  describe("restore", () => {
    it("writes plain text back where it is missing or stale, and refuses a value that will not open", async () => {
      // A row written by an image that writes sealed only.
      const fresh = await row({ accessToken: null, refreshToken: null });
      await db
        .update(serviceConnections)
        .set({
          accessTokenSealed: sealToken("at-sealed", at(fresh.userId, fresh.id, "access_token")),
          refreshTokenSealed: sealToken("rt-sealed", at(fresh.userId, fresh.id, "refresh_token")),
        })
        .where(eq(serviceConnections.id, fresh.id));
      // A row whose sealed value moved on while the plain one stayed behind.
      const stale = await row({ accessToken: "at-old", refreshToken: null });
      await db
        .update(serviceConnections)
        .set({ accessTokenSealed: sealToken("at-current", at(stale.userId, stale.id, "access_token")) })
        .where(eq(serviceConnections.id, stale.id));
      // A row sealed under a key that is no longer listed.
      process.env.CONNECTION_TOKEN_KEYS = keyB;
      const lost = await row({ accessToken: null, refreshToken: null });
      await db
        .update(serviceConnections)
        .set({ accessTokenSealed: sealToken("at-lost", at(lost.userId, lost.id, "access_token")) })
        .where(eq(serviceConnections.id, lost.id));
      process.env.CONNECTION_TOKEN_KEYS = keyA;

      expect(await restorePlaintext(db)).toEqual({ restored: 3, skipped: 0, failed: 1 });
      expect(await read(fresh.id)).toMatchObject({ accessToken: "at-sealed", refreshToken: "rt-sealed" });
      expect((await read(stale.id)).accessToken).toBe("at-current");
      expect((await read(lost.id)).accessToken).toBeNull();

      expect(await restorePlaintext(db)).toEqual({ restored: 0, skipped: 0, failed: 1 });
    });
  });

  describe("the command line", () => {
    it("prints counts only, and exits by what it found", async () => {
      await row({ accessToken: "at-secret-1", refreshToken: "rt-secret-1" });
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...a) => void lines.push(a.join(" ")));
      vi.spyOn(console, "error").mockImplementation((...a) => void lines.push(a.join(" ")));

      expect(await runTokenCommand(db, "backfill")).toBe(0);
      expect(await runTokenCommand(db, "reencrypt")).toBe(0);
      expect(await runTokenCommand(db, "restore")).toBe(0);
      expect(await runTokenCommand(db, "nonsense")).toBe(2);

      const stored = await db.execute(sql`select access_token_sealed as s from service_connections`);
      const sealed = String((stored as unknown as Array<{ s: string }>)[0].s);
      const out = lines.join("\n");
      expect(out).toMatch(/backfill: sealed=2 skipped=0 unsealed=0/);
      for (const secret of ["at-secret-1", "rt-secret-1", sealed, sealed.split(".")[3]]) {
        expect(out).not.toContain(secret);
      }
    });

    it("exits non-zero while a token is held only in plain text", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      await row({ accessToken: null, accessTokenSealed: "x", refreshToken: "rt-1" });
      // The refresh column backfills; the access column was already "sealed".
      expect(await runTokenCommand(db, "backfill")).toBe(0);
      await row({ accessToken: "at-1", refreshToken: null });
      const exit = await runTokenCommand(db, "backfill", {
        afterRead: async () => {
          await db.update(serviceConnections).set({ accessToken: "at-moved" }).where(eq(serviceConnections.accessToken, "at-1"));
        },
      });
      expect(exit).toBe(1);
    });
  });
});
