const MAX_RESPONSE_SIZE = 900_000;

export function jsonResponse(data: unknown) {
  let text = JSON.stringify(data, null, 2);
  if (text.length > MAX_RESPONSE_SIZE) {
    text = text.slice(0, MAX_RESPONSE_SIZE) + "\n\n... [truncated: response exceeded 900KB]";
  }
  return { content: [{ type: "text" as const, text }] };
}

export function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/** A long field cut to `max` characters, saying how much was left out. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} of ${text.length} chars]`;
}
