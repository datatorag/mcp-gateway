/** Where the playground turn quota is told to the client.
 *
 * Response headers, and specifically NOT a stream part or the `finish`
 * payload. A turn that suspends on an approval ends at the approval request
 * and emits no `finish` at all, so anything carried there would go missing on
 * exactly the turns where a user is most likely to run out. Headers are
 * written before the first chunk, on every turn, suspended or not.
 *
 * Named here once and imported by both ends — the route that writes them and
 * the chat client that reads them. `Headers.get` is case-insensitive, so this
 * one spelling serves both directions; a second copy could drift silently,
 * since a header that is never found simply reads as "no quota reported".
 */
export const RUNS_REMAINING_HEADER = "X-Playground-Runs-Remaining";
export const RUNS_CAP_HEADER = "X-Playground-Runs-Cap";
