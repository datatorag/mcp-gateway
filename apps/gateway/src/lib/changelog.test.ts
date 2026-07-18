import { describe, expect, it } from "vitest";
import { getAllEntries } from "./changelog";

describe("changelog", () => {
  it("returns entries sorted newest-first with parsed fields", () => {
    const entries = getAllEntries();
    expect(entries.length).toBeGreaterThanOrEqual(7);

    for (const e of entries) {
      expect(e.slug).toMatch(/^[a-z0-9-]+$/);
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(e.tags)).toBe(true);
      expect(e.html).toContain("<");
    }

    const dates = entries.map((e) => new Date(e.date).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("finds the draft lifecycle entry by slug", () => {
    const entry = getAllEntries().find((e) => e.slug === "gmail-draft-lifecycle");
    expect(entry).toBeDefined();
    expect(entry!.tags).toContain("gmail");
  });
});
