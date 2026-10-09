const MAX_RESPONSE_SIZE = 900_000; // ~900KB, under MCP's 1MB limit

export function textResponse(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

export function jsonResponse(data: unknown) {
  let text = JSON.stringify(data, null, 2);
  if (text.length > MAX_RESPONSE_SIZE) {
    text = text.slice(0, MAX_RESPONSE_SIZE) + "\n\n... [truncated — response exceeded 900KB]";
  }
  return textResponse(text);
}

/** Slice text to maxChars, appending a marker that reports how much was cut.
 * Shared marker convention for per-field truncation (gmail_read max_body_chars,
 * calendar_list_events max_description_chars). */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated ${
    text.length - maxChars
  } of ${text.length} chars]`;
}

/* SCRUM-283. Flattening used two regexes whose cost is the NUMBER of match
 * attempts, not backtracking within one: `/<[^>]+>/g` re-scans to the end of
 * the input from every `<` that never closes, and the lazy
 * `<(style|script)[\s\S]*?<\/\1>` does the same from every unclosed block.
 * Both are quadratic on such markup. That is reachable from `gmail_read` over
 * a message's `text/html` part — supplied by whoever sent the mail — on a
 * process serving every session from one event loop, so one inbound email
 * could stall every tenant.
 *
 * Replaced by two forward-only passes. They stay SEPARATE AND SEQUENTIAL
 * because the originals were: blocks are removed from the whole string first,
 * and only then are tags stripped from the RESULT, so a tag boundary can be
 * formed by the first pass's removal. Interleaving them into one walk changes
 * the output on inputs like `<div <style>x</style>`, which a differential
 * corpus against the old implementation catches immediately. */

/** Remove `<style>`/`<script>` blocks, as `/<(style|script)[\s\S]*?<\/\1>/gi`
 * did. Matching is case-insensitive and the tag name is a prefix rather than a
 * whole word, exactly as that pattern behaved, so `<styles>a</style>` is one
 * block. Once a closing tag no longer exists ahead, no later opening of that
 * name can match either, which is what stops the scan re-searching per start
 * and keeps this linear. */
function removeBlocks(html: string): string {
  // ASCII-ONLY folding, for two independent reasons, and the first is a bug
  // this had: `toLowerCase()` is not length-preserving — U+0130 (Turkish
  // capital dotted I) becomes two code units — so once one appears, every
  // offset found in the folded copy and applied to the original is shifted and
  // the rewrite cuts in the wrong place. U+0130 is the ONLY BMP character that
  // does this, which is exactly why it survives casual testing.
  //
  // The second reason is that ASCII folding is also what the pattern being
  // replaced actually did: a non-unicode `/i` regex refuses to canonicalise a
  // non-ASCII character whose case pair is ASCII, so U+017F and U+0131 never
  // matched `s` or `i` there either. Folding the full range would have been
  // wrong even with the lengths preserved.
  const lower = html.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const out: string[] = [];
  const exhausted = { style: false, script: false };
  let at = 0;
  let cursor = 0;

  while (at < html.length) {
    const open = lower.indexOf("<", at);
    if (open === -1) break;

    const tag = lower.startsWith("<style", open)
      ? "style"
      : lower.startsWith("<script", open)
        ? "script"
        : undefined;
    if (!tag || exhausted[tag]) {
      at = open + 1;
      continue;
    }

    const close = lower.indexOf(`</${tag}>`, open);
    if (close === -1) {
      exhausted[tag] = true;
      at = open + 1;
      continue;
    }
    const end = close + tag.length + 3;
    out.push(html.slice(cursor, open), " ");
    cursor = end;
    at = end;
  }

  out.push(html.slice(cursor));
  return out.join("");
}

/** Strip every tag, as `/<[^>]+>/g` did: `<`, at least one non-`>`, then `>`.
 * A bare `<>` is therefore not a tag and an unclosed trailing `<` stays
 * literal, which this reproduces exactly. */
function stripTags(html: string): string {
  const out: string[] = [];
  let at = 0;
  let cursor = 0;

  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (open === -1) break;
    const close = html.indexOf(">", open);
    if (close === -1) break;
    if (close === open + 1) {
      at = open + 1;
      continue;
    }
    out.push(html.slice(cursor, open), " ");
    cursor = close + 1;
    at = close + 1;
  }

  out.push(html.slice(cursor));
  return out.join("");
}

export function stripHtml(html: string): string {
  return stripTags(removeBlocks(html))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&shy;/g, "")
    // Collapse spacing/invisible chars common in marketing-email preheaders
    // (en/em/figure spaces, zero-width space, soft hyphen, grapheme joiner)
    .replace(/[ \t\u2000-\u200B\u00AD\u034F]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function deleteResponse(entityName: string) {
  return textResponse(`${entityName} deleted successfully.`);
}
