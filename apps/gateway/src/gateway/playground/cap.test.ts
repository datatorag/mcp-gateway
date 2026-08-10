import { describe, it, expect } from "vitest";

import { capToolOutput, TOOL_OUTPUT_CAP } from "./cap";

describe("capToolOutput", () => {
  it("leaves a result that fits exactly as it was", () => {
    // The common case by far, and the one where shape matters: a structured
    // result the model can read field by field must not become a string.
    const structured = { files: [{ id: "1", name: "notes" }], nextPageToken: null };
    expect(capToolOutput(structured)).toBe(structured);
    expect(capToolOutput("short")).toBe("short");
  });

  it("truncates an oversized string result to the cap", () => {
    const capped = capToolOutput("x".repeat(TOOL_OUTPUT_CAP * 2));
    expect(capped).toHaveLength(TOOL_OUTPUT_CAP);
  });

  it("collapses an oversized structured result to bounded text", () => {
    // Shape is worth less than a prompt that fits: an unbounded result is
    // re-sent on every later step of the turn, so one of these is paid for
    // repeatedly and can overflow the window outright.
    const capped = capToolOutput({ body: "y".repeat(TOOL_OUTPUT_CAP * 2) });
    expect(typeof capped).toBe("string");
    expect(capped).toHaveLength(TOOL_OUTPUT_CAP);
  });

  it("passes through a value it cannot serialize rather than dropping it", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(capToolOutput(circular)).toBe(circular);
    // `undefined` has no JSON form; it is still a legitimate tool result.
    expect(capToolOutput(undefined)).toBeUndefined();
  });
});
