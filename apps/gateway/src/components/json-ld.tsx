import { serializeJsonLd, type SchemaNode } from "@/lib/site-schema";

/** Serializes structured data into a page.
 *
 * THE ESCAPE IS THE WHOLE POINT. A `<` anywhere in a serialized field closes the
 * script element early, and answer text is authored prose, so the character
 * arrives through content rather than through code. This was hand-rolled
 * identically in `/faq` and in `blog/[slug]`, which is two copies of a
 * security-relevant one-liner and a third about to be written for docs. One
 * component instead, so the next surface cannot ship without it.
 *
 * Authored answers are additionally kept free of markup by the FAQ guard; this
 * is the defence that does not depend on content being well behaved. */
export function JsonLd({ nodes }: { nodes: SchemaNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(nodes) }}
    />
  );
}
