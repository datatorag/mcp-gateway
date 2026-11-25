/**
 * A post's animated cover as one SVG file (SCRUM-509): the `coverAnimation`
 * frontmatter field is a site path under /blog/ ending in .svg:
 *
 *   coverAnimation: "/blog/my-post-cover.svg"
 *     -> public/blog/my-post-cover.svg
 *
 * The file animates itself with CSS inside it. The page shows it through a
 * plain <img>, never inline, so nothing in the file can run or reach the
 * page. The post's `coverImage` is its still, as for a `coverVideo`, and a
 * post sets one of the two, not both. `blog-cover-animation.test.ts` holds
 * those rules, and what the file may contain, for every post.
 *
 * No imports, so the page and the tests read one definition.
 */

/** The shape of the field: under /blog/, lowercase words, ending in .svg. */
const COVER_ANIMATION_PATH = /^\/blog\/[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*\.svg$/;

/** The value when it is a path of that shape, else null. */
export function coverAnimationPath(coverAnimation: string | undefined): string | null {
  return coverAnimation && COVER_ANIMATION_PATH.test(coverAnimation) ? coverAnimation : null;
}

/** The largest file a cover animation may be. */
export const MAX_COVER_ANIMATION_BYTES = 300 * 1024;

/** The only namespaces a cover animation declares. Another one (XHTML, say)
 * is how an HTML script or frame gets into an SVG under a prefix. */
const ALLOWED_NAMESPACES = new Set(["http://www.w3.org/2000/svg", "http://www.w3.org/1999/xlink"]);

/**
 * What a cover animation's file holds that it may not, in words; empty when
 * nothing. The page's <img> already stops anything in the file from running
 * or fetching. This is for the file opened on its own, by its address, where
 * an SVG is a document and can do both.
 *
 * It reads the text, it does not parse the XML, so it refuses the spellings
 * it knows AND the ways a spelling can be hidden from a text match: a
 * DOCTYPE or entity (markup that only exists after expansion), a prefixed
 * element or a foreign namespace, a backslash (a CSS escape), and an
 * animation that writes a link or a handler. A reference is to something in
 * the same file (`#id`) or to data carried in it (`data:`). It is a
 * reviewer's aid, not a sandbox: a file from outside the company still gets
 * read by a person.
 */
export function coverAnimationProblems(svg: string, bytes: number): string[] {
  const problems: string[] = [];
  if (bytes >= MAX_COVER_ANIMATION_BYTES) problems.push(`is ${bytes} bytes; the limit is ${MAX_COVER_ANIMATION_BYTES}`);
  if (!/<svg[\s>]/i.test(svg)) problems.push("is not an SVG");
  if (/<script/i.test(svg)) problems.push("has a <script");
  if (/<foreignObject/i.test(svg)) problems.push("has a <foreignObject");
  if (/[\s"'/]on[a-z]+\s*=/i.test(svg)) problems.push("has an on*= event attribute");
  if (/@import/i.test(svg)) problems.push("has an @import");
  if (/<!DOCTYPE/i.test(svg)) problems.push("has a DOCTYPE");
  if (/<!ENTITY/i.test(svg)) problems.push("has an entity declaration");
  if (/<\/?[a-z][\w.-]*:[a-z]/i.test(svg)) problems.push("has a prefixed element");
  if (svg.includes("\\")) problems.push("has a backslash");
  if (/image-set\s*\(/i.test(svg)) problems.push("has an image-set(");
  if (/[\s"'/]src\s*=/i.test(svg)) problems.push("has a src= attribute");
  if (/attributeName\s*=\s*["']\s*(?:xlink:)?(?:href|on[a-z]+)\s*["']/i.test(svg)) {
    problems.push("animates a link or an event handler");
  }
  for (const m of svg.matchAll(/\bxmlns(?::[\w.-]+)?\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const ns = m[1] ?? m[2] ?? "";
    if (!ALLOWED_NAMESPACES.has(ns)) problems.push(`declares a namespace that is not SVG or xlink: ${ns.slice(0, 80)}`);
  }
  const inside = (ref: string) => /^(#|data:)/i.test(ref.trim());
  for (const m of svg.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const ref = m[1] ?? m[2] ?? "";
    if (!inside(ref)) problems.push(`has an href outside the file: ${ref.slice(0, 80)}`);
  }
  for (const m of svg.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/gi)) {
    const ref = m[1] ?? m[2] ?? m[3] ?? "";
    if (!inside(ref)) problems.push(`has a url( outside the file: ${ref.trim().slice(0, 80)}`);
  }
  return problems;
}
