/**
 * SCRUM-443 release 1: every access token the token endpoint issues is
 * stored with sha256(raw) as hex beside the raw value, on the code exchange
 * and on each refresh. Reads still match the raw value in this release.
 *
 * Real Postgres through the real router, because what is pinned is the row
 * the insert leaves behind.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens, oauthAuthorizationCodes } from "@datatorag-mcp/db";
import { hashToken } from "@datatorag-mcp/auth";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "@/test-utils/db";
import { createTokenRouter } from "./token";

const dockerAvailable = isDockerAvailable();
let db: Database;
let server: Server;
let base: string;

const CLIENT = "client-443";
const REDIRECT = "http://127.0.0.1:9999/callback";

async function post(body: Record<string, string>) {
  const res = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, string> };
}

async function storedHash(raw: string) {
  const [row] = await db
    .select({ token: oauthAccessTokens.token, tokenHash: oauthAccessTokens.tokenHash })
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.token, raw));
  return row;
}

describe.skipIf(!dockerAvailable)("the token endpoint writes the hash beside the raw token (real db)", () => {
  beforeAll(async () => {
    db = await getTestDb();
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(createTokenRouter(db));
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (typeof addr === "string" || addr === null) throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
  }, 120_000);
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await stopTestDb();
  });

  it("on the code exchange, and again on a refresh", async () => {
    const userId = await insertTestUser(db);
    const verifier = randomBytes(32).toString("base64url");
    const code = `code-${randomUUID()}`;
    await db.insert(oauthAuthorizationCodes).values({
      code,
      codeHash: hashToken(code),
      clientId: CLIENT,
      userId,
      redirectUri: REDIRECT,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + 600_000),
    });

    const exchanged = await post({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: CLIENT,
      code_verifier: verifier,
    });
    expect(exchanged.status).toBe(200);
    const first = await storedHash(exchanged.json.access_token);
    expect(first.token).toBe(exchanged.json.access_token);
    expect(first.tokenHash).toBe(hashToken(exchanged.json.access_token));
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const refreshed = await post({
      grant_type: "refresh_token",
      refresh_token: exchanged.json.refresh_token,
      client_id: CLIENT,
    });
    expect(refreshed.status).toBe(200);
    const second = await storedHash(refreshed.json.access_token);
    expect(second.tokenHash).toBe(hashToken(refreshed.json.access_token));
  });

  it("release 2: a code stored with no hash is refused, though its raw value matches", async () => {
    const userId = await insertTestUser(db);
    const verifier = randomBytes(32).toString("base64url");
    const code = `code-${randomUUID()}`;
    await db.insert(oauthAuthorizationCodes).values({
      code,
      clientId: CLIENT,
      userId,
      redirectUri: REDIRECT,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + 600_000),
    });
    const res = await post({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: CLIENT,
      code_verifier: verifier,
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_grant");
  });

  it("the hash is what Postgres computes for the backfill, so release 2's fill agrees", async () => {
    const raw = randomBytes(32).toString("base64url");
    const [row] = (await db.execute(
      // The expression migration 2 will use, against the same raw value.
      sql`SELECT encode(sha256(convert_to(${raw}, 'UTF8')), 'hex') AS h`
    )) as unknown as Array<{ h: string }>;
    expect(row.h).toBe(hashToken(raw));
  });
});
