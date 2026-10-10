import { serviceGrantStates } from "./scope-grant";

/** One account, as `list_connected_accounts` reports it. */
export type ConnectedAccountLine = {
  email: string;
  label: string | null;
  is_default: boolean;
  connected_at: string;
  /** The Google services this account granted, by name; "not recorded" for
   * a grant stored before grants were recorded. Absent for a connector whose
   * consent has no per-service choice. */
  granted_services?: string[] | "not recorded";
  /** The services it was asked for and did not grant. */
  missing_services?: string[];
  /** Where to fix a short grant. Present only when something is missing. */
  reconnect?: string;
};

/**
 * What an account actually granted, for the accounts answer (SCRUM-412).
 *
 * Google's consent screen lets a user untick services one by one, so an
 * account can be connected and still unable to do most of what is asked of
 * it. This answer is the one place a client can find that out before a call
 * fails. It took over from a plugin tool that could only say authentication
 * was handled somewhere else.
 *
 * Service NAMES, never scope URLs, and from the one module that compares a
 * grant against what the product asks for. Nothing at all for a connector
 * with no per-service opt-out. A grant that was never recorded says so: the
 * rest of the product treats it as complete, so that nothing is refused on a
 * guess, but "every service granted" here would be a reading nobody took.
 */
export function grantLine(
  connectorType: string,
  scopes: string | null | undefined
): Pick<ConnectedAccountLine, "granted_services" | "missing_services" | "reconnect"> {
  const states = serviceGrantStates(connectorType, scopes);
  if (states.length === 0) return {};
  if (scopes === null || scopes === undefined || scopes.trim() === "") {
    return { granted_services: "not recorded" };
  }
  const missing = states.filter((s) => !s.granted).map((s) => s.displayName);
  return {
    granted_services: states.filter((s) => s.granted).map((s) => s.displayName),
    missing_services: missing,
    ...(missing.length > 0
      ? {
          reconnect:
            `/dashboard/connections/${connectorType}: reconnect this account and tick every box ` +
            "on Google's consent screen to grant the missing services.",
        }
      : {}),
  };
}
