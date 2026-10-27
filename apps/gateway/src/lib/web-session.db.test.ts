/**
 * SCRUM-374: one lookup decides what a dashboard session is, on real
 * Postgres, because the rule is a WHERE clause and a stub would pass it no
 * matter what the SQL says.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens } from "@datatorag-mcp/db";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "@/test-utils/db";
import { hashToken } from "@datatorag-mcp/auth";
import { resolveBearer } from "@/gateway/bearer-auth";
import { liveWebSessionUserId, WEB_SESSION_CLIENT_ID } from "./web-session";

const dockerAvailable = isDockerAvailable();
let db: Database;

// getSessionUserId, which withRoute and withAdminRoute both call, read through
// the real helper against this database: the cookie value is set per test.
let cookie: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "dtrmcp_session" && cookie ? { value: cookie } : undefined) }),
}));
vi.mock("./db", () => ({
  get db() {
    return db;
  },
}));

const HOUR = 3600_000;

async function token(userId: string, opts: { clientId?: string; expiresIn?: number; revoked?: boolean; rawOnly?: boolean } = {}) {
  const raw = `tok-${randomUUID()}`;
  await db.insert(oauthAccessTokens).values({
    token: raw,
    tokenHash: opts.rawOnly ? null : hashToken(raw),
    clientId: opts.clientId ?? WEB_SESSION_CLIENT_ID,
    userId,
    scope: null,
    expiresAt: new Date(Date.now() + (opts.expiresIn ?? 24 * HOUR)),
    revokedAt: opts.revoked ? new Date() : null,
  });
  return raw;
}

describe.skipIf(!dockerAvailable)("liveWebSessionUserId (real db)", () => {
  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);
  afterAll(async () => {
    await stopTestDb();
  });

  it("a live web session resolves to its user", async () => {
    const userId = await insertTestUser(db);
    expect(await liveWebSessionUserId(db, await token(userId))).toBe(userId);
  });

  it("an MCP client's live access token set as the cookie is no session", async () => {
    const userId = await insertTestUser(db);
    expect(await liveWebSessionUserId(db, await token(userId, { clientId: "client-xyz" }))).toBeNull();
  });

  it("a revoked web session and an expired one are no session", async () => {
    const userId = await insertTestUser(db);
    expect(await liveWebSessionUserId(db, await token(userId, { revoked: true }))).toBeNull();
    expect(await liveWebSessionUserId(db, await token(userId, { expiresIn: -HOUR }))).toBeNull();
  });

  it("SCRUM-443 release 2: a live web session with no hash is no session, though its raw value matches", async () => {
    const userId = await insertTestUser(db);
    expect(await liveWebSessionUserId(db, await token(userId, { rawOnly: true }))).toBeNull();
  });

  it("SCRUM-443 release 2: the bearer resolves by hash, and refuses a live MCP token that has none", async () => {
    const userId = await insertTestUser(db);
    expect(await resolveBearer(db, await token(userId, { clientId: "client-xyz" }))).toEqual({
      ok: true,
      userId,
      clientId: "client-xyz",
    });
    expect(await resolveBearer(db, await token(userId, { clientId: "client-xyz", rawOnly: true }))).toEqual({
      ok: false,
      reason: "invalid",
      userId: null,
    });
  });

  it("no cookie, and an unknown value, are no session", async () => {
    expect(await liveWebSessionUserId(db, undefined)).toBeNull();
    expect(await liveWebSessionUserId(db, "never-issued")).toBeNull();
  });

  it("getSessionUserId, and so withRoute and withAdminRoute, refuse an MCP token set as the cookie", async () => {
    const { getSessionUserId } = await import("./session");
    const userId = await insertTestUser(db);
    cookie = await token(userId, { clientId: "client-xyz" });
    expect(await getSessionUserId()).toBeNull();
    cookie = await token(userId);
    expect(await getSessionUserId()).toBe(userId);
  });
});
