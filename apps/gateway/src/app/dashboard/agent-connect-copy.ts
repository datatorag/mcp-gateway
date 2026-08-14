/**
 * The strings around the in-thread connect round trip (SCRUM-78), in their own
 * module for the same reason `agent-composer-copy.ts` is: so the mechanical
 * copy rules can be asserted rather than remembered.
 *
 * The continuation message is unusual copy: it is posted AS THE USER, visibly,
 * into their own conversation, when they return from the OAuth round trip. It
 * must be visible rather than a hidden trigger — a hidden message would be
 * context the user cannot see, edit or clear, re-sent and re-billed on every
 * later turn, which is exactly the invisible-context failure the thread code
 * refuses elsewhere. So it is short, plain, and something a person could have
 * typed.
 */

/** Posted into the thread when the user lands back from a completed connect.
 * The agent's continuation rule in the system prompt keys off the meaning of
 * this message, not its exact bytes, so rewording it is safe. */
export function connectContinuationMessage(serviceName: string): string {
  return `I've just connected my ${serviceName} account. Please continue with my request.`;
}

/** Shown above the conversation when the user lands back from a connect that
 * did not finish. The control they used is still in the thread, so the next
 * step is right there. */
export const CONNECT_ERROR_NOTICE =
  "Connecting your account didn't finish. Use the Connect button in the conversation to try again.";

/** Everything above that a user reads, for the rules that apply to all of it. */
export const ALL_CONNECT_COPY = [
  connectContinuationMessage("Google Workspace"),
  connectContinuationMessage("Atlassian"),
  CONNECT_ERROR_NOTICE,
];
