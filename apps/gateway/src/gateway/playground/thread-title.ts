/**
 * A conversation's title, derived from its first user message.
 *
 * DETERMINISTIC AND FREE, NEVER MODEL-GENERATED. The same reasoning as the
 * agent's opening suggestions: a list surface is the wrong place to spend a
 * run, wait on a provider, or acquire a failure mode. A title that is just the
 * user's own opening words is instant, predictable, costs nothing, and is
 * usually what they would have typed anyway. A cleverer title is not worth a
 * spinner in a sidebar, and it is certainly not worth a title that sometimes
 * fails to appear.
 *
 * The framework leaves `title` as an empty string, so every one of these is
 * ours to write. Existing conversations have no title at all and cannot get
 * one retroactively from a first message we would have to go and read, so the
 * list falls back at render time rather than backfilling.
 */

/** Longest title we keep. Long enough for a real sentence fragment to be
 * recognisable, short enough not to wrap twice in a narrow rail. */
export const TITLE_MAX = 60;

/**
 * Turn a first user message into a title, or return null when there is nothing
 * usable in it.
 *
 * Null rather than a placeholder on purpose: the caller knows the thread's
 * date and can say something true with it, and this function should not invent
 * a label for a message it could not read.
 */
export function threadTitle(firstUserMessage: string | null | undefined): string | null {
  if (typeof firstUserMessage !== "string") return null;

  // Collapse whitespace first: a pasted block arrives with newlines and runs
  // of spaces, and truncating that raw produces a title that is mostly gap.
  const flat = firstUserMessage.replace(/\s+/g, " ").trim();
  if (flat === "") return null;

  if (flat.length <= TITLE_MAX) return flat;

  // Cut on a word boundary when one is close to the limit, so a title ends on
  // a word rather than mid-syllable. If the first sixty characters contain no
  // space at all — a URL, a long token — take the hard cut instead of
  // returning something uselessly short.
  const hard = flat.slice(0, TITLE_MAX);
  const lastSpace = hard.lastIndexOf(" ");
  const cut = lastSpace >= TITLE_MAX * 0.6 ? hard.slice(0, lastSpace) : hard;
  return `${cut.trimEnd()}…`;
}

/**
 * What the list shows when a conversation has no usable title: its date.
 *
 * Every thread has one, so this always says something true, which is the whole
 * point of preferring it to "Untitled". It also covers the conversations that
 * already exist, which were stored before anything wrote titles.
 */
export function fallbackTitle(createdAt: Date | string): string {
  const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "Chat";
  return `Chat on ${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}
