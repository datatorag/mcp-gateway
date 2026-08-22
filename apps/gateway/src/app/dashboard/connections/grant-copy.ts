/**
 * The words the grant panel says (SCRUM-106), in their own module for the same
 * reason `agent-connect-copy.ts` is: so the mechanical copy rules can be
 * ASSERTED rather than remembered.
 *
 * Two rules matter more here than on most surfaces. This copy is read at the
 * exact moment a user has discovered the product cannot do what they asked, so
 * it must not overclaim and must not blame them. And it must never name a
 * COUNT: "all eight services" is true today and becomes a lie the first time a
 * scope is added or dropped, on the one surface whose whole purpose is telling
 * the truth about access. Name the things, never how many.
 */

/** Everything is granted. Deliberately not "you're all set", which reads as
 * congratulation for a thing the user did not consciously do. */
export const GRANT_ALL_GRANTED = "Every service was granted.";

/** The commonest real state by a wide margin (per HQ decision, see
 * SCRUM-106): the consent screen was reached and every service was unticked.
 *
 * ONE SENTENCE, NOT A LIST. There is nothing useful to enumerate when the
 * answer is "none of them", and rendering a row per service here would turn
 * the most common state into a wall of identical failures that reads as the
 * product being broken rather than as one setting being off. */
export const GRANT_NONE_GRANTED =
  "No Google services were granted, so no Google tools can run.";

/** Heading over the services this grant does cover. */
export const GRANT_AVAILABLE_LABEL = "Available";

/** Heading over the services it does not. Not "Unavailable" or "Failed": the
 * access was never given, which is a different and less alarming fact than
 * something having broken. */
export const GRANT_NOT_GRANTED_LABEL = "Not granted";

/** Sits under the not-granted group. The chips above name the services, so
 * this only has to supply the consequence. */
export const GRANT_PARTIAL_CONSEQUENCE = "Tools for these services cannot run.";

/** The one control. Says what it does and what the user gets, because
 * "Reconnect" alone reads as fixing a broken connection rather than granting
 * access that was never given. Matches the string the SCRUM-136 banner
 * shipped, so the label does not change under anyone mid-ticket. */
export const GRANT_RECONNECT_LABEL = "Reconnect and grant access";

/** The closed disclosure holding the raw scope strings. Per HQ decision (see
 * SCRUM-106) the raw values stay behind it and never render by default. */
export const GRANT_DISCLOSURE_LABEL = "Show what was granted";

/** Shown inside the disclosure when the connection predates scope recording,
 * so an empty box does not read as "nothing was granted" when the truth is
 * "we did not write it down". */
export const GRANT_DISCLOSURE_EMPTY = "No scope record was stored for this connection.";

/** Every line above that a user reads, for the rules that apply to all of it. */
export const ALL_GRANT_COPY = [
  GRANT_ALL_GRANTED,
  GRANT_NONE_GRANTED,
  GRANT_AVAILABLE_LABEL,
  GRANT_NOT_GRANTED_LABEL,
  GRANT_PARTIAL_CONSEQUENCE,
  GRANT_RECONNECT_LABEL,
  GRANT_DISCLOSURE_LABEL,
  GRANT_DISCLOSURE_EMPTY,
];
