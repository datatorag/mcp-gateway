/** Best-effort revocation of a Google OAuth grant.
 *
 * Called when a user disconnects an account: deleting only our rows would
 * leave the grant live on Google's side, where any previously leaked copy of
 * the refresh token would keep working. Revoking the refresh token kills the
 * whole grant, including derived access tokens.
 *
 * Deliberately never throws and never logs the token (an error handler that
 * logged the token it failed to revoke would be worse than the bug). The
 * token travels in the POST body, not the query string, so it can never
 * appear in a URL that request logs or proxies might keep. Time-bounded so a
 * hung upstream cannot hang a disconnect.
 */

export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

const REVOKE_TIMEOUT_MS = 5000;

export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[google-revoke] upstream returned ${res.status}`);
    }
    return res.ok;
  } catch (err) {
    // err.name only: never the message, which for exotic failures could
    // echo request details.
    console.warn(
      `[google-revoke] revoke request failed: ${err instanceof Error ? err.name : "unknown"}`
    );
    return false;
  }
}
