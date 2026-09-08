import { describe, expect, it } from "vitest";
import { normalizeToolResult } from "./engine";

/* SCRUM-225: the runtime's tool results into the classifier's shape. Three
 * shapes are known; anything else is a call with no text, never a throw. */

describe("normalizeToolResult", () => {
  it("reads the flat shape with an MCP content array", () => {
    expect(
      normalizeToolResult({
        toolName: "gws-mcp__gmail_search",
        result: { content: [{ type: "text", text: "3 messages" }], isError: false },
      })
    ).toEqual({ toolName: "gws-mcp__gmail_search", resultText: "3 messages", isError: false });
  });

  it("reads the payload-wrapped shape and the error flag", () => {
    expect(
      normalizeToolResult({
        type: "tool-result",
        payload: {
          toolName: "gws-mcp__gmail_send",
          result: { content: [{ type: "text", text: "google-workspace is not connected." }], isError: true },
        },
      })
    ).toEqual({
      toolName: "gws-mcp__gmail_send",
      resultText: "google-workspace is not connected.",
      isError: true,
    });
  });

  it("stringifies a plain-object result and passes a string result through", () => {
    expect(normalizeToolResult({ toolName: "t", output: { ok: true } })).toEqual({
      toolName: "t",
      resultText: '{"ok":true}',
      isError: false,
    });
    expect(normalizeToolResult({ toolName: "t", result: "done" })?.resultText).toBe("done");
  });

  it("returns null for shapes with no tool name", () => {
    expect(normalizeToolResult(null)).toBeNull();
    expect(normalizeToolResult({ result: "x" })).toBeNull();
    expect(normalizeToolResult("string")).toBeNull();
  });
});
