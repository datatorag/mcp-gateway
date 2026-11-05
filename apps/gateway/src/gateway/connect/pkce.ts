import { createHash, randomBytes } from "node:crypto";

/** A PKCE verifier (43 URL-safe characters from 32 random bytes) and its S256
 * challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
