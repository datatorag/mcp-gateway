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

/** The Calendar rows were re-checked separately and later, and the standfirst
 * says so rather than moving the sitewide date: claiming the whole table was
 * re-verified when only one section was would be the same kind of overclaim
 * the correction exists to remove. */
export const CALENDAR_VERIFIED_ON = "10 August 2026";
