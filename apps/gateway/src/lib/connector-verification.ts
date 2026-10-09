/** When the built-in connector comparison was last established by testing.
 *
 * A module of its own, and NOT a constant inside the table component, because
 * two surfaces make the same dated claim: the table on the home page, and the
 * FAQ answer beneath it that says the same thing in prose. One of them having
 * its own copy of the date is how a retest moves the table and leaves an
 * answer asserting the old one, in the surface built to be quoted away from the
 * page. The component previously exported it directly; a content module
 * importing a component pulled the whole icon library into the guard's module
 * graph, which is its own kind of wrong.
 *
 * ONE DATE AGAIN. From August to October 2026 there were three: the Gmail and
 * Calendar groups were each re-checked on a day of their own, and saying so
 * was the honest thing while the rest of the table had not been. On this date
 * every group was re-enumerated, both columns, so the section dates are gone.
 * If one group is re-checked alone again, give it its own constant again
 * rather than moving this one: claiming the whole table was re-verified when
 * one section was is the overclaim the separate dates existed to prevent.
 *
 * Rendered, not just recorded. Change it only when the rows have actually
 * been retested, and see the rules in `components/connector-comparison.tsx`. */
export const VERIFIED_ON = "9 October 2026";
