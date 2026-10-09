/** Reading an address header the way RFC 5322 writes one (SCRUM-310).
 *
 * `To`, `Cc`, `From` and `Reply-To` hold a list of mailboxes, and a mailbox is
 * more than "text, then an address in angle brackets". A display name may be a
 * quoted string holding commas, quotes and angle brackets (`"Doe, Jane" <j@x>`),
 * a comment in parentheses may sit anywhere, and a group
 * (`Team: a@x, b@x;`) wraps several mailboxes in one entry. Splitting on
 * commas, or taking the text between the last `<` and the next `>`, reads all
 * of those wrongly, and what it reads becomes the recipient of a reply.
 *
 * This is one pass over the characters with no backtracking, so the cost is
 * linear in the header whatever it contains. The values come from mail other
 * people sent, so nothing here is trusted: an entry whose address is not a
 * plain `local@domain` is dropped rather than repaired.
 */

export interface Mailbox {
  /** The display name, unquoted and unescaped; absent when there is none. */
  name?: string;
  address: string;
}

/** `local@domain` with no whitespace, control character or structural
 * character in either half. Deliberately narrower than the grammar: an
 * address this refuses is one no recipient header should carry. */
const ADDRESS = /^[^\s<>()\[\]\\,;:"@\x00-\x1f\x7f]+@[^\s<>()\[\]\\,;:"@\x00-\x1f\x7f]+$/;

/** The longest header this will read. A real recipient list is far shorter;
 * past this the rest is ignored rather than parsed. */
const MAX_HEADER = 64 * 1024;

export function parseAddressList(header: string | undefined): Mailbox[] {
  if (!header) return [];
  const text = header.length > MAX_HEADER ? header.slice(0, MAX_HEADER) : header;
  const out: Mailbox[] = [];

  let phrase = ""; // display-name text seen so far in this entry
  let angle: string | null = null; // contents of <...>, once seen
  let quoted = false; // whether any of `phrase` came from a quoted string
  let i = 0;

  const flush = () => {
    const bare = phrase.trim();
    if (angle !== null) {
      const address = angle.trim();
      if (ADDRESS.test(address)) out.push(bare ? { name: bare, address } : { address });
    } else if (!quoted && ADDRESS.test(bare)) {
      // A bare address is never taken from quoted text: a quoted string is a
      // display name, and one that happens to read like an address is the
      // shape used to make a name pass for a recipient.
      out.push({ address: bare });
    }
    phrase = "";
    angle = null;
    quoted = false;
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      // quoted-string: everything to the closing quote is literal, with
      // backslash escaping the next character.
      i++;
      quoted = true;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < text.length) i++;
        phrase += text[i];
        i++;
      }
      i++; // the closing quote, or past the end
    } else if (ch === "(") {
      // comment: skipped, nesting respected.
      let depth = 1;
      i++;
      while (i < text.length && depth > 0) {
        if (text[i] === "\\" && i + 1 < text.length) i++;
        else if (text[i] === "(") depth++;
        else if (text[i] === ")") depth--;
        i++;
      }
    } else if (ch === "<") {
      // A second angle address in one entry is not a mailbox. Which of the
      // two a reader would take is anybody's guess, so neither is.
      const second: boolean = angle !== null;
      const close = text.indexOf(">", i + 1);
      if (close === -1) {
        // Unterminated: nothing after this is an address.
        angle = "";
        i = text.length;
      } else {
        angle = second ? "" : text.slice(i + 1, close);
        i = close + 1;
      }
    } else if (ch === ",") {
      flush();
      i++;
    } else if (ch === ":") {
      // A group's name ends here; its members follow as ordinary entries.
      // A "name" that already holds an address is not a group name. It is a
      // header written to read as one recipient and parse as another, so
      // nothing after it is taken.
      if (angle !== null || phrase.includes("@")) {
        phrase = "";
        angle = null;
        break;
      }
      phrase = "";
      quoted = false;
      i++;
    } else if (ch === ";") {
      // End of a group: closes the last member like a comma would.
      flush();
      i++;
    } else if (ch === "\r" || ch === "\n") {
      // A line break followed by whitespace is a folded header and reads as
      // a space. Any other line break is the end of this header: what comes
      // after it is a different line, and reading on would let text shaped
      // like a second header supply an address.
      while (i < text.length && (text[i] === "\r" || text[i] === "\n")) i++;
      if (text[i] !== " " && text[i] !== "\t") break;
      phrase += " ";
    } else {
      phrase += ch;
      i++;
    }
  }
  flush();
  return out;
}

/** The first mailbox's address, or "" when the header holds none. */
export function firstAddress(header: string | undefined): string {
  return parseAddressList(header)[0]?.address ?? "";
}

/** The addresses alone, comma separated: what a reply's To and Cc carry.
 * The display names stay behind on purpose. They were written by whoever
 * sent the original, and a header this client builds should hold nothing a
 * stranger chose except the address itself. */
export function addressLine(mailboxes: Mailbox[]): string {
  return mailboxes.map((m) => m.address).join(", ");
}

/** An address as it is compared: ASCII letters lowered and nothing else.
 * `toLowerCase` also folds letters outside ASCII onto ASCII ones (the Kelvin
 * sign U+212A becomes "k"), which would make two different addresses compare
 * equal in the one place equality decides who receives mail. */
export function addressKey(address: string): string {
  return address.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** The same mailboxes with later repeats of an address removed, and with any
 * address in `exclude` removed. Addresses compare case-insensitively. */
export function distinctMailboxes(mailboxes: Mailbox[], exclude: Iterable<string> = []): Mailbox[] {
  const seen = new Set<string>([...exclude].map(addressKey));
  const out: Mailbox[] = [];
  for (const m of mailboxes) {
    const key = addressKey(m.address);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}
