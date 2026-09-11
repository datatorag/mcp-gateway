import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { apiKeys, oauthAccessTokens } from "@datatorag-mcp/db";
import { generateApiKey, getKeyPrefix, hashApiKey } from "@datatorag-mcp/auth";
import { isTokenLive } from "@/lib/token-liveness";
import { classifyAuthFailure, type AuthFailureReason } from "./mcp-analytics";

/**
 * The bearer on /mcp is one of two credentials (SCRUM-245).
 *
 * An OAuth access token is what an interactive client holds: short-lived,
 * refreshed through a single-use refresh token that rotates on every use.
 * That rotation is right for a client that persists what it is handed and
 * fatal for one that does not: a CLI that loads a credential file and never
 * writes it back spends the stored refresh token on its first refresh and is
 * dead from then on. Re-authenticating buys one access-token lifetime.
 *
 * An API key is the machine credential: minted by the account holder from
 * the dashboard, scoped to that one user, revocable, shown once, and
 * accepted here exactly like an access token, with no refresh and no
 * rotation. The alternative, letting a marked client reuse a refresh token
 * inside a grace window, was rejected: it keeps rotation semantics the client
 * cannot honour and makes the token's liveness depend on a clock race.
 *
 * What does NOT change with the credential: the MCP server the identity is
 * handed to, the tool classification, the approval policy, and the usage
 * metering. A key is a way in, not a different kind of user.
 *
 * The raw key is a secret. It is hashed on arrival and on minting, only the
 * hash and a short display prefix are stored, and nothing in this module
 * logs, captures, or returns the raw value except the one minting response.
 */

/** Stamped as client_id on every tool_call a key makes, the way "web" marks
 * dashboard sessions: a fixed literal, since a key is not an OAuth
 * registration and mints no client id of its own. */
export const API_KEY_CLIENT_ID = "api-key";

/** A user holds at most this many live keys. Enough for a harness, a CI
 * job and a laptop each; few enough that a leaked account cannot fan out. */
export const MAX_LIVE_KEYS = 10;
const MAX_NAME_LENGTH = 60;

/** The prefix every minted key starts with, as the auth package writes it. */
const API_KEY_PREFIX = "sk-dtrmcp_";

export function isApiKeyShaped(rawToken: string): boolean {
  return rawToken.startsWith(API_KEY_PREFIX);
}

export type AuthKind = "oauth" | "api_key";

export type BearerAuth =
  | { ok: true; userId: string; clientId: string; authKind: "oauth" }
  | { ok: true; userId: string; clientId: string; authKind: "api_key"; keyId: string }
  | { ok: false; reason: AuthFailureReason; userId: string | null };

/**
 * Resolves a bearer to an identity, or to a classified refusal.
 *
 * A key-shaped bearer is looked up by its hash and never touches the OAuth
 * table; anything else takes the OAuth path exactly as before. Refusals name
 * the owner where the row exists (a revoked or expired credential still says
 * whose it was) so the failure event attributes.
 */
export async function resolveBearer(db: Database, rawToken: string): Promise<BearerAuth> {
  if (isApiKeyShaped(rawToken)) {
    const [key] = await db
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        revokedAt: apiKeys.revokedAt,
        expiresAt: apiKeys.expiresAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hashApiKey(rawToken)))
      .limit(1);
    if (key && isTokenLive(key)) {
      return { ok: true, userId: key.userId, clientId: API_KEY_CLIENT_ID, authKind: "api_key", keyId: key.id };
    }
    return { ok: false, reason: classifyAuthFailure(key), userId: key?.userId ?? null };
  }

  const [token] = await db
    .select({
      userId: oauthAccessTokens.userId,
      clientId: oauthAccessTokens.clientId,
      revokedAt: oauthAccessTokens.revokedAt,
      expiresAt: oauthAccessTokens.expiresAt,
    })
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.token, rawToken))
    .limit(1);
  if (token && isTokenLive(token)) {
    return { ok: true, userId: token.userId, clientId: token.clientId, authKind: "oauth" };
  }
  return { ok: false, reason: classifyAuthFailure(token), userId: token?.userId ?? null };
}

/** Records that a key opened a session. Fire-and-forget by callers; a
 * failed touch changes nothing about the session. */
export async function touchApiKey(db: Database, keyId: string): Promise<void> {
  try {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyId));
  } catch (err) {
    console.warn("[api-key] last-used touch failed", err instanceof Error ? err.name : "unknown");
  }
}

/** What the dashboard shows about a key. Never the hash. */
export type ApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revoked: boolean;
};

export type CreateApiKeyResult =
  | { ok: true; key: ApiKeySummary; rawKey: string }
  | { ok: false; reason: "invalid_name" | "too_many" };

/**
 * Mints a key for the caller. The raw value is returned once, here, and is
 * not recoverable afterwards: only its hash is stored.
 */
export async function createApiKey(db: Database, userId: string, name: unknown): Promise<CreateApiKeyResult> {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return { ok: false, reason: "invalid_name" };

  const [live] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
  if ((live?.n ?? 0) >= MAX_LIVE_KEYS) return { ok: false, reason: "too_many" };

  const rawKey = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ userId, name: trimmed, keyHash: hashApiKey(rawKey), keyPrefix: getKeyPrefix(rawKey) })
    .returning({ id: apiKeys.id, createdAt: apiKeys.createdAt });
  return {
    ok: true,
    rawKey,
    key: {
      id: row!.id,
      name: trimmed,
      prefix: getKeyPrefix(rawKey),
      createdAt: row!.createdAt,
      lastUsedAt: null,
      expiresAt: null,
      revoked: false,
    },
  };
}

export async function listApiKeys(db: Database, userId: string): Promise<ApiKeySummary[]> {
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(sql`${apiKeys.createdAt} desc`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.keyPrefix,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    revoked: r.revokedAt !== null,
  }));
}

/**
 * Revokes one of the caller's own live keys. The update is guarded on the
 * owner and on the key being live, so a foreign id and a second revoke both
 * change nothing and answer false. Revocation takes effect on the next
 * request: every /mcp request resolves its bearer afresh.
 */
export async function revokeApiKey(db: Database, userId: string, keyId: string): Promise<boolean> {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return rows.length === 1;
}
