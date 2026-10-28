/**
 * Argument aliases (SCRUM-456): a name a caller reaches for that is not the
 * tool's, accepted as the one it means. Each alias is listed in the tool's
 * schema, so the gateway's argument check lets it through, and is mapped
 * here before the handler reads the canonical name. The answer names the
 * argument the value was read as, so the caller learns the tool's word.
 */

export type AliasNote = { aliased: Record<string, string> };

/**
 * Moves `args[alias]` to `args[canonical]` (through `convert` when given),
 * and returns the note for the answer, or null when the alias was not used.
 * Giving both is refused: the two cannot both be meant.
 */
export function takeAlias(
  toolName: string,
  args: Record<string, unknown>,
  alias: string,
  canonical: string,
  convert: (value: unknown) => unknown = (v) => v
): AliasNote | null {
  if (args[alias] === undefined || args[alias] === null) return null;
  if (args[canonical] !== undefined && args[canonical] !== null) {
    throw new Error(`${toolName}: give "${canonical}" or "${alias}", not both. Nothing was sent.`);
  }
  args[canonical] = convert(args[alias]);
  delete args[alias];
  return { aliased: { [alias]: canonical } };
}

/** The canonical argument, refused by name when neither it nor its alias was given. */
export function requireOneOf(toolName: string, args: Record<string, unknown>, canonical: string, alias: string): void {
  if (args[canonical] === undefined || args[canonical] === null) {
    throw new Error(`${toolName}: missing required parameter "${canonical}" (or "${alias}"). Nothing was sent.`);
  }
}
