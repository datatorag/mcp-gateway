import { describe, expect, it } from "vitest";
import { driveFileState } from "./drive-state";

const answer = (text: string, isError = false) => ({ content: [{ type: "text", text }], isError });

describe("driveFileState", () => {
  it("reads a not-found as gone", () => {
    expect(driveFileState(answer("File not found: x.", true))).toBe("gone");
    expect(driveFileState(answer("HTTP 404", true))).toBe("gone");
  });

  it("tells a trashed file from one still present", () => {
    expect(driveFileState(answer(JSON.stringify({ id: "x", trashed: true })))).toBe("trashed");
    expect(driveFileState(answer(JSON.stringify({ id: "x", trashed: false })))).toBe("present");
    // Drive omits a field at its default, so an absent `trashed` is not trashed.
    expect(driveFileState(answer(JSON.stringify({ id: "x" })))).toBe("present");
  });

  it("never reads an unreadable answer as gone", () => {
    expect(() => driveFileState(answer("permission denied", true))).toThrow(/other than not-found/);
    expect(() => driveFileState(answer("not json"))).toThrow(/not JSON/);
    expect(() => driveFileState(answer(JSON.stringify({ error: "x" })))).toThrow(/names no file/);
    expect(() => driveFileState(answer("null"))).toThrow(/names no file/);
  });
});
