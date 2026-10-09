import { describe, expect, it } from "vitest";
import { stripHtml } from "./response.js";

/* SCRUM-283. stripHtml flattens HTML with a tag pattern whose cost is driven
 * by the NUMBER of match attempts, so markup with many unclosed tags makes it
 * quadratic. That matters because `gmail_read` with `text_only` runs it over a
 * message's text/html part, which is ATTACKER-SUPPLIED — an inbound HTML-only
 * email — on a process that serves every session from one event loop. Anyone
 * who can email one of our users can stall every tenant.
 *
 * THE FIXTURE SHAPE IS THE WHOLE TEST. A single "<div " followed by filler
 * costs nothing under either implementation, because the cost comes from every
 * start re-scanning the rest of the input. The lever is how many starts there
 * are, not how big the body is. */
describe("stripHtml is linear (SCRUM-283)", () => {
  const manyUnclosed = (kb: number) => "<div ".repeat(Math.ceil((kb * 1024) / 5));

  /* 256KB is chosen, not arbitrary. It is large enough that the cost curve
   * this replaced blows the bound by roughly an order of magnitude, and small
   * enough that reintroducing the bug REDDENS THIS PROMPTLY instead of hanging
   * the runner: the flatten is synchronous, so a blocked event loop stops
   * vitest enforcing its own timeout, and a much larger input turns a failing
   * test into a suite that never finishes. A check that cannot complete is a
   * check nobody runs. Scaling beyond this is evidence for the commit message,
   * measured by hand, not a test. */
  it("does not stall on markup with many unclosed tags", () => {
    const started = Date.now();
    stripHtml(manyUnclosed(256));
    expect(Date.now() - started).toBeLessThan(1000);
  });

});

/* The flatten was rewritten from two regexes into two forward-only passes, so
 * the output must be proven unchanged rather than assumed. This carries the
 * ORIGINAL implementation as an oracle and compares against it over a seeded
 * corpus built from the tokens that actually exercise the branches. It caught
 * a real divergence during the rewrite: an early version fused the two passes
 * into one walk, which changes the result on input like `<div <style>x</style>`
 * because the block removal can CREATE a tag boundary the second pass then
 * sees. The passes must stay separate and sequential. */
describe("stripHtml output is unchanged (SCRUM-283)", () => {
  /** stripHtml exactly as it was before the rewrite. */
  function original(html: string): string {
    return html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&shy;/g, "")
      .replace(/[ \t\u2000-\u200B\u00AD\u034F]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim();
  }

  const EDGE = [
    "", "<>", "<", ">", "a<b", "<<a>", "a<b<c>d", "<a<>b>", "<>x<>",
    "<div>hi</div>", "<DIV CLASS='x'>hi</DIV>", "<br/>",
    "<style>p{color:red}</style>body", "<STYLE>x</STYLE>y",
    "<script>var a='<b>'</script>tail", "<style>unclosed", "<script>unclosed",
    "<style>a</style><style>b</style>c", "<styles>notstyle</styles>",
    "<style>a</SCRIPT>b</style>c", "<style></style>", "<style</style>",
    "<div <style>x</style>", // the fused-pass divergence
    "&nbsp;&amp;&lt;&gt;&quot;&#65;&#x41;&shy;", "&amp;lt;",
    // CASE HAZARDS. U+0130 is the only BMP character whose toLowerCase
    // changes LENGTH (one code unit becomes two), so folding the whole string
    // and then indexing the original desynchronises every later offset — a
    // real bug this suite did not catch until it was pointed out. U+0131 and
    // U+017F are the other half of the story: their case pair is ASCII, and a
    // non-unicode /i regex deliberately does NOT canonicalise them, so folding
    // beyond ASCII would be wrong even at equal length.
    "\u0130\u0130\u0130\u0130<style>p{color:red}</style>Merhaba",
    "<\u0130style>a</style>b", "<sty\u0130le>a</style>b",
    "\u0130<script>x</script>\u0130", "<STYLE>\u0130</style>\u0130tail",
    "\u0131<style>a</style>", "\u017F<style>a</style>", "<\u017Ftyle>a</style>",
    "\u212A<script>a</script>", "<div \u0130>x", "\u0130\u0130<>\u0130",
    // astral characters: two code units each, case mappings stay 1:1
    "\u{1D400}<style>a</style>\u{1D401}", "\u{10400}<style>a</style>\u{10428}",
    "<!-- comment -->x", "<!DOCTYPE html>y", "<div\nclass='multi'>z",
    "<div class='>'>q", "<style>a<style>b</style>c</style>d", "text<style", "<sty",
  ];

  it("matches the original on hand-picked edge cases", () => {
    for (const input of EDGE) {
      expect(stripHtml(input), `input: ${JSON.stringify(input)}`).toBe(original(input));
    }
  });

  it("matches the original across a seeded random corpus", () => {
    const alphabet = ["<", ">", "<div ", "</div>", "<style>", "</style>", "<script>",
      "</script>", "a", " ", "\n", "&amp;", "&#65;", "<>", "'", '"', "/", "<STYLE>", "</SCRIPT>",
      // the case hazards, mixed in so they land at arbitrary offsets and
      // before/after block boundaries rather than only in curated positions
      "\u0130", "\u0131", "\u017F", "\u212A", "\u{1D400}", "<\u0130", "\u0130>"];
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 6000; i++) {
      let input = "";
      const n = 1 + Math.floor(rnd() * 60);
      for (let k = 0; k < n; k++) input += alphabet[Math.floor(rnd() * alphabet.length)];
      expect(stripHtml(input), `input: ${JSON.stringify(input)}`).toBe(original(input));
    }
  });

  it("matches the original on realistic mail markup", () => {
    const samples = [
      `<!DOCTYPE html><html><head><style type="text/css">body{margin:0}</style></head>` +
        `<body><table><tr><td><a href="https://example.com/x?a=1&amp;b=2">Click&nbsp;here</a></td></tr></table>` +
        `<script>if(a<b){}</script><p>Regards,<br>Dana</p></body></html>`,
      `<div dir="ltr">Hi<div><br></div></div><div class="gmail_quote">` +
        `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex">earlier<br></blockquote></div>`,
      `<span style="font-family:&quot;Arial&quot;">attr</span>&#8217;s &#x2019; test&shy;here`,
    ];
    for (const input of samples) expect(stripHtml(input)).toBe(original(input));
  });
});

describe("the block scan is linear too (SCRUM-283)", () => {
  it("does not stall on many unclosed <style> starts", () => {
    const started = Date.now();
    stripHtml("<style>".repeat(Math.ceil((256 * 1024) / 7)));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
