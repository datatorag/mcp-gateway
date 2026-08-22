import type { ScopeStatus } from "./types";

/**
 * The four states a connection can be in, and the words for each (SCRUM-106).
 *
 * WHY THIS IS NOT PER-SERVICE. The ticket asks for "available / partial /
 * unavailable" per service. Partial cannot exist there: each of the eight
 * Google services maps to exactly ONE scope, so a service is granted or it is
 * not, and a third per-service state would be fiction on the one surface whose
 * job is to stop the product overstating access. Three states ARE right one
 * level up, at the connection, which is also where the actual complaint lives:
 * a green "Connected" badge on an account that granted nothing.
 *
 * Kept out of the component so the rule is testable without rendering, and so
 * the card badge and the panel cannot disagree about what state a row is in.
 */
export type GrantState = "complete" | "partial" | "none" | "disconnected";

export function grantState(
  scopeStatus: ScopeStatus | undefined,
  isConnected: boolean
): GrantState {
  if (!isConnected) return "disconnected";
  // Fail-open, matching scopeDelta: a row this model knows nothing about
  // reads as working rather than nagging someone whose connection is fine.
  if (!scopeStatus || scopeStatus.complete) return "complete";
  const services = scopeStatus.services;
  // "none" is the COMMON case, not the edge one (per HQ decision, see
  // SCRUM-106): reaching the consent screen and unticking everything. It gets
  // its own state because the recovery copy is different — there is nothing to
  // enumerate, so naming eight services would be noise where one sentence is
  // the whole story.
  if (services.length > 0 && services.every((s) => !s.granted)) return "none";
  return "partial";
}

/** The badge label for each state. Deliberately not "Connected" for anything
 * short: that word is what this ticket exists to stop overclaiming. */
export const GRANT_STATE_LABEL: Record<GrantState, string> = {
  complete: "Connected",
  partial: "Partial access",
  none: "No access granted",
  disconnected: "Not connected",
};

/** Which Badge variant carries each state. `warning`/`success` are semantic
 * tokens with dark-theme values, never hardcoded palette colours. */
export const GRANT_STATE_VARIANT: Record<
  GrantState,
  "success" | "warning" | "secondary"
> = {
  complete: "success",
  partial: "warning",
  none: "warning",
  disconnected: "secondary",
};
