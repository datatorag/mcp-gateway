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

/** Which stored thread this turn landed in (SCRUM-78).
 *
 * The client cannot compute it: a NEW conversation's thread id is derived
 * server-side as a one-way hash of the session user and the client id, and
 * the inline Connect control needs the real id to compose the `?next=` path
 * that brings the OAuth round trip back into this exact thread. Only ever
 * tells a user the id of a thread they themselves just wrote to, which the
 * thread-list API already hands them. Same header-not-stream-part reasoning
 * as the quota pair above. */
export const THREAD_ID_HEADER = "X-Playground-Thread-Id";
