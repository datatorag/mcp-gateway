/**
 * A blog post can carry a scripted demo: a marker on its own line in the
 * post's markdown, `<!-- demo:jira -->`, is replaced on the page by the demo
 * window for that script id.
 *
 * The marker is an HTML comment because `marked` passes comments through
 * untouched, so it survives into the post's HTML for the page to split on
 * (the docs' `<!--setup-instructions-->` works the same way), and because a
 * comment renders nothing anywhere else the post's markdown is read: a feed,
 * a preview, an excerpt.
 *
 * Pure and free of React so the split can be tested without a DOM, and so a
 * test can read every post's markers against the scripts that exist.
 */

export type PostSegment =
  | { kind: "html"; html: string }
  | { kind: "demo"; id: string };

/** One marker. Lowercase ids only, the shape script ids have. */
const DEMO_MARKER = /<!--\s*demo:([a-z0-9-]+)\s*-->/g;

/** Every demo id a post's HTML asks for, in order, known or not. */
export function demoMarkerIds(html: string): string[] {
  return [...html.matchAll(DEMO_MARKER)].map((m) => m[1]);
}

/**
 * Split a post's HTML at its demo markers.
 *
 * A post with no marker comes back as ONE html segment holding the string it
 * was given, byte for byte, so a post that never asked for a demo renders
 * exactly as it did before this existed.
 *
 * A marker naming an id that is not in `known` is left where it is, as the
 * comment it already was: it renders nothing rather than an empty frame, and
 * `demo-embed.test.ts` fails on it before it can ship.
 */
export function splitDemoMarkers(
  html: string,
  known: readonly string[]
): PostSegment[] {
  const segments: PostSegment[] = [];
  let from = 0;
  for (const match of html.matchAll(DEMO_MARKER)) {
    if (!known.includes(match[1])) continue;
    const before = html.slice(from, match.index);
    if (before.trim().length > 0) segments.push({ kind: "html", html: before });
    segments.push({ kind: "demo", id: match[1] });
    from = match.index + match[0].length;
  }
  if (segments.length === 0) return [{ kind: "html", html }];
  const rest = html.slice(from);
  if (rest.trim().length > 0) segments.push({ kind: "html", html: rest });
  return segments;
}
