/**
 * SCRUM-466: a connect link is a credential, stored by hash and spent once.
 * Real Postgres, because single use is a guarded UPDATE and a stub would pass
 * whatever the WHERE clause says.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { connectLinks, type Database } from "@datatorag-mcp/db";
import { hashToken } from "@datatorag-mcp/auth";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "@/test-utils/db";
import {
  claimConnectLink,
  dropConnectLinksForUser,
  issueConnectLink,
  peekConnectLink,
  spentConnectLink,
  sweepConnectLinks,
} from "./connect-links";

const dockerAvailable = isDockerAvailable();
let db: Database;

const BASE = "https://gateway.example";

function tokenOf(url: string) {
  return url.slice(`${BASE}/connect/`.length);
}

async function issue(userId: string) {
  return issueConnectLink(db, {
    userId,
    provider: "google-workspace",
    path: "tool_result",
    clientName: "Claude",
    baseUrl: BASE,
  });
}

describe.skipIf(!dockerAvailable)("connect links (real db)", () => {
  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);
  afterAll(async () => {
    await stopTestDb();
  });

  it("stores the token's hash and never the token", async () => {
    const userId = await insertTestUser(db);
    const { id, url } = await issue(userId);
    const token = tokenOf(url);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await db.select().from(connectLinks).where(eq(connectLinks.id, id));
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("is spent once: the second claim gets nothing", async () => {
    const userId = await insertTestUser(db);
    const token = tokenOf((await issue(userId)).url);
    const first = await claimConnectLink(db, token);
    expect(first).toMatchObject({ userId, provider: "google-workspace", path: "tool_result" });
    expect(await claimConnectLink(db, token)).toBeNull();
    expect(await peekConnectLink(db, token)).toBeNull();
  });

  it("peeking spends nothing", async () => {
    const userId = await insertTestUser(db);
    const token = tokenOf((await issue(userId)).url);
    expect(await peekConnectLink(db, token)).not.toBeNull();
    expect(await peekConnectLink(db, token)).not.toBeNull();
    expect(await claimConnectLink(db, token)).not.toBeNull();
  });

  it("an expired link and an unknown token read the same as a spent one", async () => {
    const userId = await insertTestUser(db);
    const { id, url } = await issue(userId);
    await db.update(connectLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(connectLinks.id, id));
    expect(await peekConnectLink(db, tokenOf(url))).toBeNull();
    expect(await claimConnectLink(db, tokenOf(url))).toBeNull();
    expect(await claimConnectLink(db, "A".repeat(43))).toBeNull();
    expect(await claimConnectLink(db, "not a token")).toBeNull();
  });

  it("a round trip finds its link by token, only once spent and only within the window", async () => {
    const userId = await insertTestUser(db);
    const { id, url } = await issue(userId);
    const token = tokenOf(url);
    expect(await spentConnectLink(db, token, 600_000)).toBeNull();
    await claimConnectLink(db, token);
    expect(await spentConnectLink(db, token, 600_000)).toMatchObject({ id, userId });
    // The row id is no credential.
    expect(await spentConnectLink(db, id, 600_000)).toBeNull();
    await db.update(connectLinks).set({ spentAt: new Date(Date.now() - 700_000) }).where(eq(connectLinks.id, id));
    expect(await spentConnectLink(db, token, 600_000)).toBeNull();
  });

  it("drops a user's links and nobody else's", async () => {
    const a = await insertTestUser(db);
    const b = await insertTestUser(db);
    const ta = tokenOf((await issue(a)).url);
    const tb = tokenOf((await issue(b)).url);
    await dropConnectLinksForUser(db, a);
    expect(await peekConnectLink(db, ta)).toBeNull();
    expect(await peekConnectLink(db, tb)).not.toBeNull();
  });

  it("sweeps rows a day past expiry and keeps the rest", async () => {
    const userId = await insertTestUser(db);
    const old = await issue(userId);
    const fresh = await issue(userId);
    await db
      .update(connectLinks)
      .set({ expiresAt: new Date(Date.now() - 25 * 3600_000) })
      .where(eq(connectLinks.id, old.id));
    await sweepConnectLinks(db);
    const ids = (await db.select({ id: connectLinks.id }).from(connectLinks).where(eq(connectLinks.userId, userId))).map((r) => r.id);
    expect(ids).toEqual([fresh.id]);
  });
});
