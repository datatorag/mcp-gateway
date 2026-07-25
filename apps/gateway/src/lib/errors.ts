// Never forward a caught Error.message to the client — on a public gateway it
// can leak internal detail (DB/driver text, stack-adjacent strings). Log the
// real error server-side and hand the client this generic message instead.
/** The sanitized, non-actionable message `logAndGenericError` hands the
 * client. Exported as the single source of truth so client code can RECOGNISE
 * it — the playground chat renders a server-authored `errorText` verbatim
 * (that's how actionable copy like the expired-confirmation notice reaches the
 * user) and needs to tell that apart from this placeholder, which it replaces
 * with its own canonical wording. Compared by value on the client, so a change
 * here must stay in step with that check.
 *
 * NOTE: this string is user-facing on every route that calls
 * `logAndGenericError`, not just the playground — do not retune it for one
 * surface. */
export const GENERIC_ERROR_MESSAGE =
  "Something went wrong while processing your request.";

export function logAndGenericError(context: string, err: unknown): string {
  console.error(context, err);
  return GENERIC_ERROR_MESSAGE;
}
