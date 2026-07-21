// Never forward a caught Error.message to the client — on a public gateway it
// can leak internal detail (DB/driver text, stack-adjacent strings). Log the
// real error server-side and hand the client this generic message instead.
export function logAndGenericError(context: string, err: unknown): string {
  console.error(context, err);
  return "Something went wrong while processing your request.";
}
