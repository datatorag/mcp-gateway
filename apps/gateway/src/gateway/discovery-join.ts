/**
 * The two OAuth-side events that let a sign-up be joined back to the
 * discovery that preceded it (SCRUM-481). Both carry the same salted keys
 * `mcp_discovery` does, computed from their own request:
 *
 * - `discovery_id`, a hash of IP plus user agent. Registration is made by the
 *   MCP client itself, the same process that discovered, so on
 *   `mcp_client_registered` it matches the discovery's distinct id exactly.
 *   The authorization request is the user's BROWSER, whose user agent is not
 *   the client's, so on `mcp_oauth_authorized` it matches only a client that
 *   runs in that browser.
 * - `peer_hash`, a hash of the IP alone, which matches a desktop client and
 *   its user's browser on the same network.
 *
 * Never an IP, never an email in a property; the authorization event is
 * under the user id like every other server-side event about a user.
 * Never throws: analytics does not break an OAuth step.
 */
import type { Request } from "express";
import { getPosthog } from "../lib/posthog-server";
import { EVENTS } from "../lib/analytics";
import { discoveryKeys } from "./auth-failure-context";
import { cleanClientName } from "./untrusted-text";

export function trackClientRegistered(
  req: Request,
  salt: string,
  client: { clientId: string; clientName: string | null }
): void {
  try {
    const ph = getPosthog();
    if (!ph) return;
    const keys = discoveryKeys(req, salt);
    ph.capture({
      // The client, not a person: the registration has no user yet.
      distinctId: keys.discovery_id ?? "mcp_anonymous",
      event: EVENTS.MCP_CLIENT_REGISTERED,
      properties: {
        client_id: client.clientId,
        client_name: cleanClientName(client.clientName) ?? "",
        ...keys,
        $process_person_profile: false,
      },
    });
  } catch (err) {
    console.warn("[discovery-join] registration capture failed", err instanceof Error ? err.message : err);
  }
}

export function trackOauthAuthorized(
  req: Request,
  salt: string,
  opts: { userId: string; clientId: string; clientName: string | null; newUser: boolean }
): void {
  try {
    const ph = getPosthog();
    if (!ph) return;
    ph.capture({
      distinctId: opts.userId,
      event: EVENTS.MCP_OAUTH_AUTHORIZED,
      properties: {
        client_id: opts.clientId,
        client_name: cleanClientName(opts.clientName) ?? "",
        new_user: opts.newUser,
        ...discoveryKeys(req, salt),
      },
    });
  } catch (err) {
    console.warn("[discovery-join] authorization capture failed", err instanceof Error ? err.message : err);
  }
}
