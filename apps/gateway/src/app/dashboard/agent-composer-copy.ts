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

/** Nothing connected yet. Names the account the user is most likely to be
 * bringing and asks for one thing. */
export const COMPOSER_PLACEHOLDER_UNCONNECTED =
  "Connect your Google account to get started.";

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
