/** The one source for every statement the site makes about Claude's built-in
 * Google connectors: the vendor page it rests on, and the day that page was
 * last read.
 *
 * THE RULE. A sentence or a table cell about the built-in connectors says only
 * what Anthropic's own help page says on BUILT_IN_CHECKED_ON, no more strongly
 * than the page, and carries that date. What the page does not say is not
 * asserted: not a limit, not a beta label, not a count of accounts. Where a
 * table needs a cell for something the page is silent on, the cell says "Not
 * described", which is a statement about the page and not about the product.
 *
 * Until November 25, 2026 this module held two dates from our own enumeration
 * of the connectors' tool lists (one for the table, one for Google Slides).
 * Those statements outlived the product they described: the site said Slides
 * decks arrived empty and Docs and Sheets editing was in beta for weeks after
 * the vendor's page said otherwise. A tool list we enumerated cannot be shown
 * to a reader; the vendor's page can, so that is what the claims rest on now.
 *
 * A module of its own, and NOT a constant inside the table component or the
 * FAQ module, because several surfaces make the same dated claim: the home
 * page's two tables, the demo caption, the hosted landing page, and the FAQ
 * answers. One of them having its own copy of the date is how a re-read moves
 * the table and leaves an answer asserting the old one. A content module
 * importing a component would also pull the icon library into the FAQ guard's
 * module graph.
 *
 * Rendered, not just recorded. Move the date ONLY after re-reading
 * BUILT_IN_HELP_URL and checking every built-in cell and sentence against it. */
export const BUILT_IN_HELP_URL =
  "https://support.claude.com/en/articles/10166901-use-google-workspace-connectors";

/** The day BUILT_IN_HELP_URL was last read, as a sentence prints it. */
export const BUILT_IN_CHECKED_ON = "November 25, 2026";
