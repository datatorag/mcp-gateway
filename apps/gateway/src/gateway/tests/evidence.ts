import { scrubSensitiveText } from "../usage/redact";

/** 4 KB, and the marker says a truncation happened rather than leaving a
 * sentence that stops mid-word looking like the whole story. */
export const EVIDENCE_CAP = 4096;
export const TRUNCATION_MARKER = "\n... evidence truncated";

/**
 * What a person needs to believe a result (SCRUM-303), and nothing more.
 *
 * It scrubs with `scrubSensitiveText`, the pattern list the usage sink uses,
 * rather than with `redactErrorMessage`: that one also caps at 500
 * characters and rebuilds error envelopes, which is right for an upstream
 * error message and destroys a multi-line evidence block.
 *
 * ONE CONSEQUENCE TO KNOW, AND IT IS A TENSION WITH THE SPEC. The shared
 * pattern list replaces any run of 20 or more word characters with
 * `[redacted-id]`, because that is the shape of a Drive file id, a sheet id
 * and a Gmail message id. Evidence therefore cannot name an artifact by id,
 * while the spec says a leaked cleanup should "name the artifact". Both
 * cannot hold. v1 takes the safe side: over-redaction loses information a
 * person can recover another way, under-redaction is irreversible once the
 * row is written and served by `tests_results`. A leaked cleanup still
 * names the TOOL, the zone and the run stamp, which is enough to find the
 * leftover by listing. HQ owns whether to loosen it.
 *
 * The rule this enforces mechanically is the cap and the scrub. The rule
 * it CANNOT enforce is the important one, so it is stated here for whoever
 * writes a case: evidence records SHAPES AND COMPARISONS, not payloads.
 * "body contains the token: yes", never the body. A run that stored message
 * bodies would be a second copy of a mailbox, sitting in a table that a
 * whole dashboard page renders.
 */
export function formatEvidence(
  lines: readonly string[],
  safe: readonly string[] = [],
  shapes: readonly RegExp[] = []
): string {
  const joined = lines.join("\n");
  const redacted = protect(joined, safe, scrubSensitiveText, shapes);
  if (redacted.length <= EVIDENCE_CAP) return redacted;
  return redacted.slice(0, EVIDENCE_CAP - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

/** The sentinel that stands in for a protected token while the scrub runs.
 * Chosen so no pattern in the list can match it: the guillemets are outside
 * `[A-Za-z0-9_-]`, so the id pattern's word run is only the digits, and it
 * carries no `@` and no key prefix. */
const OPEN = "\u00ab";
const CLOSE = "\u00bb";
/** Padding, outside every pattern's character class. */
const PAD = "\u00b7";

/**
 * Runs `scrub` over `text` with `safe` tokens held back (SCRUM-303).
 *
 * THE PATTERN LIST IS NOT FORKED, and that is the point. The shared list
 * replaces any run of 20 or more word characters with `[redacted-id]`
 * because that is the shape of a Drive id; `gws-mcp__sheets_query` is 21
 * characters, so the skip reason "this run does not serve
 * gws-mcp__sheets_query" arrived unreadable, and so did the fixture address
 * a send refusal named. Both are things a reader NEEDS. Loosening the
 * pattern would have loosened it for real ids too.
 *
 * So the tokens are masked before the scrub and restored after. What counts
 * as safe is decided by the caller and is deliberately narrow: names this
 * run actually served, and the addresses this run was configured with.
 * An arbitrary long string is not safe, a customer's address is not safe,
 * and an id this run happened to create is not safe.
 *
 * FAILS CLOSED. If the text already contains the sentinel, restoring could
 * corrupt it, so nothing is protected and everything is scrubbed.
 */
/** `«n»` padded to `width` so masking never changes the text's length. */
function sentinel(slot: number, width: number): string {
  const core = `${OPEN}${slot}${CLOSE}`;
  if (width <= core.length) return core;
  return core + PAD.repeat(width - core.length);
}

/** The token where it stands alone, never inside a longer address or id. */
function standalone(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_.@+-])${escaped}(?![A-Za-z0-9_.@+-])`, "g");
}

export function protect(
  text: string,
  safe: readonly string[],
  scrub: (value: string) => string,
  shapes: readonly RegExp[] = []
): string {
  /* A SHAPE, not a longer list. A4's whole job is naming tools that are
   * NOT in `tools/list`: one the plugin serves and the registry lacks, or
   * one the registry has and nothing serves. Neither can ever appear in a
   * safe list derived from what was served, so A4's finding arrived as
   * "registry lacks: [redacted-id]" — the redaction eating the one word
   * that made the finding actionable.
   *
   * Widening the list cannot fix that. What identifies a tool name is its
   * STRUCTURE: a known plugin slug, then `__`, then a name. A Google id
   * cannot take that form at a token boundary, because it would have to
   * begin with a literal installed slug. So matches of that shape join the
   * tokens and go through exactly the same masking, boundaries and padding
   * as the rest — no second code path, no second set of properties to
   * keep true. */
  const found = shapes.flatMap((shape) => [...text.matchAll(shape)].map((m) => m[0]));
  const tokens = [...new Set([...safe, ...found])].filter((t) => t.length > 0);
  if (tokens.length === 0) return scrub(text);
  if (text.includes(OPEN) || text.includes(CLOSE) || text.includes(PAD)) return scrub(text);

  // Longest first, so a token that contains another is masked whole.
  tokens.sort((a, b) => b.length - a.length);

  let masked = text;
  const used: string[] = [];
  for (const token of tokens) {
    if (!masked.includes(token)) continue;
    const slot = used.length;
    const stand = sentinel(slot, token.length);
    // Two properties the naive replace did not have, both found by review
    // with worked examples rather than reasoned about:
    //
    // BOUNDARIES. Replacing every occurrence broke a safe token out of a
    // string that merely CONTAINED it, so `runner@ours.test` protected
    // `notrunner@ours.test`, and a long id with a tool name inside it
    // survived in two sub-20 halves. Only a standalone occurrence is
    // protected now.
    //
    // LENGTH. The stand-in is padded to the token's own length, because
    // the quoted-content rule triggers on runs over 40 characters and
    // shortening the line could drop a genuine payload under the
    // threshold. Masking must not change what the other patterns see.
    const before = masked;
    masked = masked.replace(standalone(token), stand);
    if (masked === before) continue;
    used.push(token);
    if (stand !== sentinel(used.length - 1, token.length)) {
      throw new Error("evidence: sentinel slots drifted");
    }
  }

  let out = scrub(masked);
  for (let i = 0; i < used.length; i += 1) {
    out = out.split(sentinel(i, used[i].length)).join(used[i]);
  }
  return out;
}

/**
 * The shape of a namespaced tool name, for the plugins actually installed.
 *
 * Built from the registry's own slugs rather than a pattern like
 * `\\w+__\\w+`, so the only strings it can protect are ones that begin with
 * a plugin this gateway really has. A slug that is not a plain name is
 * dropped rather than compiled in, which a test pins: slugs are registry
 * data, and registry data does not get to extend a regex.
 *
 * THE LOOKAROUNDS HERE ARE BELT AND BRACES, and that is stated rather than
 * left to be assumed. Deleting them turns no test red, because what
 * actually keeps a tool name from being carved out of a longer id is the
 * boundary check in `standalone`, applied when the token is masked. They
 * stay because this regex is the thing that decides what a tool name IS,
 * and it should say so on its own terms rather than relying on a property
 * enforced two functions away. Do not "cover" them with a test that
 * reaches past the masking to call this directly.
 */
export function toolNameShapes(slugs: readonly string[]): RegExp[] {
  const usable = slugs.filter((s) => /^[A-Za-z0-9-]+$/.test(s));
  if (usable.length === 0) return [];
  const alternation = usable.map((s) => s.replace(/-/g, "\\-")).join("|");
  return [
    new RegExp(
      `(?<![A-Za-z0-9_.@+-])(?:${alternation})__[A-Za-z0-9_]+(?![A-Za-z0-9_.@+-])`,
      "g"
    ),
  ];
}
