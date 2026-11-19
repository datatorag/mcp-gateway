/**
 * Names joined as prose, with the serial comma: "A", "A and B", "A, B, and
 * C". The one joiner for every list a page, a tool answer, or an email
 * writes, so house style is applied in one place.
 */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
