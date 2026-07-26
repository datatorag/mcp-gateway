import { describe, expect, it } from "vitest";

import { formatToolOutput } from "./format-tool-output";

describe("formatToolOutput", () => {
  it("unwraps an MCP text envelope and pretty-prints the inner JSON", () => {
    const inner = JSON.stringify([
      { id: "19f9f79665b5256d", threadId: "19f9f79665b5256d" },
    ]);
    const result = formatToolOutput({
      content: [{ type: "text", text: inner }],
    });

    expect(result).not.toContain("\\n");
    expect(result).not.toContain('\\"');
    expect(result).toContain('"id": "19f9f79665b5256d"');
  });

  it("joins multiple content items with newlines", () => {
    const result = formatToolOutput({
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    });

    expect(result).toBe("first\nsecond");
  });

  it("stringifies non-text content items instead of dropping them", () => {
    const result = formatToolOutput({
      content: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });

    expect(result).toContain('"type": "image"');
    expect(result).toContain('"mimeType": "image/png"');
  });

  it("leaves non-JSON text untouched", () => {
    const result = formatToolOutput({
      content: [{ type: "text", text: "Deleted message 123." }],
    });

    expect(result).toBe("Deleted message 123.");
  });

  it("stringifies plain objects without a content array", () => {
    expect(formatToolOutput({ ok: true })).toBe(
      JSON.stringify({ ok: true }, null, 2)
    );
  });

  it("does not treat an empty content array as an envelope", () => {
    expect(formatToolOutput({ content: [] })).toBe(
      JSON.stringify({ content: [] }, null, 2)
    );
  });

  it("pretty-prints a bare string that is itself JSON", () => {
    const result = formatToolOutput('{"a":1}');
    expect(result).toBe('{\n  "a": 1\n}');
  });

  it("returns non-JSON strings as-is", () => {
    expect(formatToolOutput("plain text")).toBe("plain text");
  });

  it("does not expand scalar JSON strings", () => {
    expect(formatToolOutput("123")).toBe("123");
    expect(formatToolOutput("true")).toBe("true");
  });
});
