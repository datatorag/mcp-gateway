import { formatConnectedDate } from "@/lib/utils";

/**
 * The words of "Apps you approved" on the Connections page, in one place for
 * review. "App" is the approval page's own word for a client, so this section
 * uses it too. `approved-apps.test.tsx` holds the house rules over every
 * line here.
 */
export const APPROVED_APPS_TITLE = "Apps you approved";

/** What Remove does, in one sentence. True of `endGrantForClient`: the app's
 * tokens are revoked and its approval is deleted, so its next sign-in shows
 * the approval page again. */
export const APPROVED_APPS_INTRO =
  "Remove ends an app's access: it can no longer use DataToRAG as you until you add it again and approve it.";

export const APPROVED_APPS_EMPTY = "No apps can use DataToRAG as you right now.";
export const APPROVED_APPS_UNAVAILABLE = "Your approved apps could not be loaded. Reload the page to try again.";

/** The name is whatever the app registered with; nobody checked it. */
export const NAME_UNVERIFIED = "The app gave this name, and DataToRAG does not verify it.";
export const UNNAMED_APP = "An app with no name";

export const REMOVE_LABEL = "Remove";
export const REMOVE_CONFIRM_LABEL = "Remove app";
export const REMOVE_CANCEL_LABEL = "Cancel";
export const REMOVE_ERROR = "Could not remove the app. Try again.";

export function removeConfirm(name: string | null): string {
  return `Remove ${name ?? "this app"}? It will stop working with DataToRAG until you add it again and approve it.`;
}

/** Where a sign-in for this app is sent back to: the hosts it registered. */
export function sendsTo(hosts: readonly string[]): string {
  if (hosts.length === 0) return "";
  const list =
    hosts.length === 1
      ? hosts[0]
      : hosts.length === 2
        ? `${hosts[0]} or ${hosts[1]}`
        : `${hosts.slice(0, -1).join(", ")}, or ${hosts[hosts.length - 1]}`;
  return `Sign-in returns to ${list}.`;
}

/** No date means no approval was recorded: the app was added before
 * DataToRAG showed an approval page. */
export function approvedOn(iso: string | null): string {
  return iso ? `Approved ${formatConnectedDate(iso)}` : "Added before DataToRAG asked for approval";
}

/** The day DataToRAG last issued this app a token, which happens at sign-in
 * and each time the app renews its access. Not the time of its last call. */
export function lastTokenOn(iso: string | null): string {
  return iso ? `Access last renewed ${formatConnectedDate(iso)}` : "No access issued yet";
}
