import { safeStringEqual } from "@datatorag-mcp/auth";

// Shared CSRF-nonce plumbing for the OAuth-initiating flows (MCP authorize,
// plugin connect, Atlassian connect). Each flow sets an httpOnly cookie holding
// this nonce and echoes it in the OAuth `state`; the callback requires the two
// to match, binding the round-trip to the browser that began it.

// 10-minute browser round-trip window. One constant so the Express (ms) and
// Next.js (seconds) cookie APIs can't drift into a 1000x unit mistake.
export const OAUTH_STATE_TTL_SECONDS = 600;
export const OAUTH_STATE_TTL_MS = OAUTH_STATE_TTL_SECONDS * 1000;

/**
 * True only if both nonces are present and equal. Constant-time compare is
 * belt-and-suspenders here (the nonce is single-use and high-entropy), but it
 * keeps the guard identical across every flow.
 */
export function nonceMatches(
  cookieNonce: string | undefined,
  stateNonce: string | undefined
): boolean {
  return (
    !!cookieNonce && !!stateNonce && safeStringEqual(cookieNonce, stateNonce)
  );
}
