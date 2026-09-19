/** When the built-in connector comparison was last established by testing.
 *
 * A module of its own, and NOT a constant inside the table component, because
 * two surfaces now make the same dated claim: the table on the home page, and
 * the FAQ answer beneath it that says the same thing in prose. One of them
 * having its own copy of the date is how a retest moves the table and leaves an
 * answer asserting the old one, in the surface built to be quoted away from the
 * page. The component previously exported it directly; a content module
 * importing a component pulled the whole icon library into the guard's module
 * graph, which is its own kind of wrong.
 *
 * Rendered, not just recorded. Change these only when the rows have actually
 * been retested, and see the rules in `components/connector-comparison.tsx`. */
export const VERIFIED_ON = "7 August 2026";

/** The Gmail rows were re-enumerated on this date and three of them changed:
 * the built-in connector sends, replies and forwards. It gained those verbs in
 * August 2026, our own three-way comparison recorded that on 24 August 2026,
 * and this table went on claiming the opposite for another three weeks. That is
 * the failure rule 2 in `connector-comparison.tsx` exists to prevent, and a
 * separate date is how the correction stays legible: the rest of the table was
 * NOT re-checked on this date and must not be presented as though it was. */
export const GMAIL_VERIFIED_ON = "18 September 2026";

/** The Calendar rows were re-checked separately and later, and the standfirst
 * says so rather than moving the sitewide date: claiming the whole table was
 * re-verified when only one section was would be the same kind of overclaim
 * the correction exists to remove. */
export const CALENDAR_VERIFIED_ON = "10 August 2026";
