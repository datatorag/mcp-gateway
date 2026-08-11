/**
 * The composer's placeholder, in each state the composer can be in.
 *
 * In its own module for the same reason `agent-cap-copy.ts` is: so the
 * mechanical rules can be ASSERTED rather than remembered. That module already
 * pins "playground" out of user-facing text, and this copy broke the rule
 * anyway, because the test could only see strings the module exported. The
 * placeholder sat inline in `playground.tsx` saying "Connect an account to try
 * the playground" on the surface that is becoming the front door. A rule
 * enforced in one file and violated in the file next to it is the failure this
 * module exists to close.
 */

/** Nothing connected yet.
 *
 * SERVICE-NEUTRAL ON PURPOSE. An earlier version named Google specifically,
 * which read as a precondition rather than an example: the empty state
 * directly above this offers Google Workspace AND Atlassian as peer buttons,
 * so singling one out narrows what the product does for an Atlassian-only
 * user. Staying neutral also sidesteps a naming inconsistency, since the
 * connector is called "Google Workspace" everywhere else in the product and a
 * placeholder saying "Google account" disagreed with the button beside it.
 *
 * Keep it neutral as connectors are added. The connect controls enumerate the
 * services; this line only has to ask for one. */
export const COMPOSER_PLACEHOLDER_UNCONNECTED =
  "Connect an account to get started.";

/** The ordinary state. */
export const COMPOSER_PLACEHOLDER_READY = "Ask something…";

/** A gated write is waiting on a decision, and the composer is locked until it
 * gets one. The placeholder says why, so the lock does not read as a fault. */
export const COMPOSER_PLACEHOLDER_AWAITING_CONFIRM =
  "Approve or deny the action above to continue";

/** Every placeholder, for the rules that apply to all of them. */
export const ALL_COMPOSER_PLACEHOLDERS = [
  COMPOSER_PLACEHOLDER_UNCONNECTED,
  COMPOSER_PLACEHOLDER_READY,
  COMPOSER_PLACEHOLDER_AWAITING_CONFIRM,
];
