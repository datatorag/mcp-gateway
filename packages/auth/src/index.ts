import crypto from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { LRUCache } from "lru-cache";
import type { Database } from "@datatorag-mcp/db";
import { apiKeys } from "@datatorag-mcp/db";

const API_KEY_PREFIX = "sk-dtrmcp_";

export interface ApiKeyValidationResult {
  valid: boolean;
  userId?: string;
  apiKeyId?: string;
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Constant-time string comparison for secrets (PKCE challenges, OAuth
 * client_id / redirect_uri, tokens). Both inputs are hashed to fixed-length
 * SHA-256 digests first, so the comparison never throws on a length mismatch
 * and leaks no length information, then compared with timingSafeEqual (no
 * short-circuit / early return).
 */
export function safeStringEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function generateApiKey(): string {
  const bytes = crypto.randomBytes(32);
  return `${API_KEY_PREFIX}${bytes.toString("base64url")}`;
}

export function getKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, API_KEY_PREFIX.length + 4);
}

export class ApiKeyValidator {
  private cache: LRUCache<string, ApiKeyValidationResult>;

  constructor(private db: Database) {
    this.cache = new LRUCache<string, ApiKeyValidationResult>({
      max: 10_000,
      ttl: 60_000, // 60 seconds
    });
  }

  async validate(rawKey: string): Promise<ApiKeyValidationResult> {
    if (!rawKey.startsWith(API_KEY_PREFIX)) {
      return { valid: false };
    }

    const keyHash = hashApiKey(rawKey);
    const cached = this.cache.get(keyHash);
    if (cached) return cached;

    const [row] = await this.db
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        revokedAt: apiKeys.revokedAt,
        expiresAt: apiKeys.expiresAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (!row) {
      const result: ApiKeyValidationResult = { valid: false };
      this.cache.set(keyHash, result);
      return result;
    }

    if (row.revokedAt) {
      const result: ApiKeyValidationResult = { valid: false };
      this.cache.set(keyHash, result);
      return result;
    }

    if (row.expiresAt && row.expiresAt < new Date()) {
      const result: ApiKeyValidationResult = { valid: false };
      this.cache.set(keyHash, result);
      return result;
    }

    const result: ApiKeyValidationResult = {
      valid: true,
      userId: row.userId,
      apiKeyId: row.id,
    };
    this.cache.set(keyHash, result);
    return result;
  }

  invalidateCache(keyHash: string): void {
    this.cache.delete(keyHash);
  }
}
