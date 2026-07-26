/**
 * MCP tool results arrive as {content: [{type: "text", text: "<JSON string>"}]}.
 * Stringifying that envelope double-encodes the inner JSON — the panel shows
 * literal \n and \" throughout. Unwrap content[].text (the shape the
 * connections test-runner already renders) and pretty-print any text that is
 * itself JSON, so the card shows structure instead of one escaped line.
 */

type McpContent = { text?: unknown };

const hasContentArray = (
  value: object
): value is { content: McpContent[] } => {
  const content = (value as { content?: unknown }).content;
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((item) => typeof item === "object" && item !== null)
  );
};

const prettyPrintIfJson = (text: string): string => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    // Not JSON — render as-is.
  }
  return text;
};

export function formatToolOutput(output: unknown): string {
  if (typeof output === "string") {
    return prettyPrintIfJson(output);
  }
  if (typeof output === "object" && output !== null) {
    if (hasContentArray(output)) {
      return output.content
        .map((item) =>
          typeof item.text === "string"
            ? prettyPrintIfJson(item.text)
            : JSON.stringify(item, null, 2)
        )
        .join("\n");
    }
    return JSON.stringify(output, null, 2);
  }
  return JSON.stringify(output, null, 2) ?? String(output);
}
