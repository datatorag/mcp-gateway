/**
 * Address-list parsing for the send guard (SCRUM-303).
 *
 * Splitting a recipient header on commas is the obvious thing and it is
 * wrong: a quoted display name may contain one, so `"Doe, Jane" <j@x>` is
 * ONE address that a naive split turns into two, the first of which parses
 * as nothing recognisable. A guard that then refuses is merely annoying; a
 * guard that skips what it cannot parse is a hole.
 *
 * So this parser is deliberately strict and small. It understands quoted
 * strings, angle brackets and comments, and it REFUSES anything it cannot
 * account for rather than doing its best. Refusing costs a failed case;
 * guessing costs a message sent to a stranger.
 */

export type ParsedAddress = { raw: string; address: string };

export class AddressParseError extends Error {}

/** Splits on commas that are outside quotes, angle brackets and comments. */
function splitEntries(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  let inAngle = false;
  let commentDepth = 0;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      current += ch;
      escaped = true;
      continue;
    }
    if (inQuotes) {
      current += ch;
      if (ch === '"') inQuotes = false;
      continue;
    }
    if (commentDepth > 0) {
      if (ch === "(") commentDepth += 1;
      else if (ch === ")") commentDepth -= 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      current += ch;
      continue;
    }
    if (ch === "(") {
      commentDepth += 1;
      continue;
    }
    if (ch === "<") {
      if (inAngle) throw new AddressParseError("nested < in an address list");
      inAngle = true;
      current += ch;
      continue;
    }
    if (ch === ">") {
      if (!inAngle) throw new AddressParseError("a > with no matching <");
      inAngle = false;
      current += ch;
      continue;
    }
    if (ch === "," && !inAngle) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  if (escaped) throw new AddressParseError("an address list ending in a backslash");
  if (inQuotes) throw new AddressParseError("an unterminated quoted string");
  if (inAngle) throw new AddressParseError("an unterminated < >");
  if (commentDepth > 0) throw new AddressParseError("an unterminated ( ) comment");
  out.push(current);
  return out;
}

/** The addr-spec out of one entry: `Name <a@b>`, `<a@b>` or `a@b`. */
function addrSpec(entry: string): string {
  const trimmed = entry.trim();
  if (trimmed === "") throw new AddressParseError("an empty address");

  const open = trimmed.indexOf("<");
  let spec: string;
  if (open !== -1) {
    const close = trimmed.indexOf(">", open);
    if (close === -1) throw new AddressParseError("an unterminated < >");
    spec = trimmed.slice(open + 1, close).trim();
    const tail = trimmed.slice(close + 1).trim();
    if (tail !== "") throw new AddressParseError(`unexpected text after an address: ${JSON.stringify(tail.slice(0, 20))}`);
  } else {
    if (trimmed.includes('"')) throw new AddressParseError("a display name with no address");
    spec = trimmed;
  }

  // Exactly one @, a local part and a domain with a dot. A group syntax
  // (`undisclosed:;`) has no @ and is refused here, which is correct: the
  // guard must know every recipient by name.
  const at = spec.indexOf("@");
  if (at <= 0 || at !== spec.lastIndexOf("@") || at === spec.length - 1) {
    throw new AddressParseError(`not an address: ${JSON.stringify(spec.slice(0, 30))}`);
  }
  const domain = spec.slice(at + 1);
  if (!domain.includes(".") || /[\s<>,;]/.test(spec)) {
    throw new AddressParseError(`not an address: ${JSON.stringify(spec.slice(0, 30))}`);
  }
  return spec.toLowerCase();
}

/**
 * Every address in a recipient header. Throws `AddressParseError` on
 * anything it cannot fully account for.
 *
 * An empty or absent header is an empty list, not an error: a message with
 * no `cc` is ordinary. A header that is present and unparseable is an error.
 */
export function parseAddressList(input: unknown): ParsedAddress[] {
  if (input === undefined || input === null) return [];
  if (typeof input !== "string") {
    throw new AddressParseError(`a recipient field must be a string, got ${typeof input}`);
  }
  if (input.trim() === "") return [];

  return splitEntries(input).map((entry) => ({ raw: entry.trim(), address: addrSpec(entry) }));
}
