import { describe, expect, it } from "vitest";
import { listOf } from "./list-of";

describe("listOf", () => {
  it("joins names as prose at every length, with the serial comma", () => {
    expect(listOf([])).toBe("");
    expect(listOf(["Gmail"])).toBe("Gmail");
    expect(listOf(["Gmail", "Drive"])).toBe("Gmail and Drive");
    expect(listOf(["Gmail", "Drive", "Calendar"])).toBe("Gmail, Drive, and Calendar");
  });
});
