/** The most text one result carries (SCRUM-471). A query's rows are capped
 * before this; this is the last line, for a row that is itself huge. */
export const MAX_RESPONSE_CHARS = 50_000;

/** A JSON result, cut at MAX_RESPONSE_CHARS. A cut result says so, and how
 * much was left out, in a line no JSON parser would mistake for data. */
export function jsonResponse(data: unknown) {
  let text = JSON.stringify(data, null, 2);
  if (text.length > MAX_RESPONSE_CHARS) {
    const dropped = text.length - MAX_RESPONSE_CHARS;
    text = `${text.slice(0, MAX_RESPONSE_CHARS)}\n\n... [truncated: ${dropped} of ${text.length} characters left out. Ask for fewer rows or fewer columns.]`;
  }
  return { content: [{ type: "text" as const, text }] };
}

/** At most `max` of a list, with whether any were left out. */
export function capRows<T>(rows: readonly T[], max: number): { rows: T[]; truncated: boolean } {
  return { rows: rows.slice(0, max), truncated: rows.length > max };
}

/** At most `max` of an object's own keys, in their order. */
export function capKeys(value: unknown, max: number): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, max));
}
