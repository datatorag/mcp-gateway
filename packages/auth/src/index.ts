import crypto from "node:crypto";

/**
 * SHA-256 of a secret, as hex: how the gateway stores a token it must be able
 * to recognise but never needs to read back (refresh tokens today). Renamed
 * from `hashApiKey` when API keys were removed (SCRUM-451); the value is the
 * same.
 */
export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
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
