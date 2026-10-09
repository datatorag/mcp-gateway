import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { allTools } from "./tools/index.js";

/**
 * The documented tool counts must equal the tools that actually ship.
 *
 * A count in prose is a claim that has to stay true forever, and it goes stale
 * silently: nothing in a compiler or a test suite reads a README, so the number
 * is only ever checked by someone who happens to doubt it. This repository's
 * counts have been found wrong more than once, in both directions.
 *
 * This is a test rather than a checklist item because a checklist protects a
 * ritual and a test protects the file. Adding or removing a tool now fails
 * here until the docs are updated in the same change.
 *
 * The better fix, and one worth doing separately, is to stop counting in prose
 * at all: naming the services survives every change to how many tools each one
 * has. Until then, this keeps the number honest.
 */
const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), "utf-8");

describe("documented tool counts", () => {
  it("README states the real total", () => {
    const stated = /\*\*(\d+) tools total\.\*\*/.exec(read("README.md"));
    expect(stated, "README.md no longer states a total in the pinned form").not.toBeNull();
    expect(Number(stated![1])).toBe(allTools.length);
  });

  it("CLAUDE.md states the real total", () => {
    const stated = /expose (\d+) tools/.exec(read("CLAUDE.md"));
    expect(stated, "CLAUDE.md no longer states a total in the pinned form").not.toBeNull();
    expect(Number(stated![1])).toBe(allTools.length);
  });

  it("README's per-service table sums to the same total", () => {
    // The total and the table are two claims, and fixing one without the other
    // is the likelier mistake: the total is the sentence people notice.
    const rows = [...read("README.md").matchAll(/^\| \*\*\w+\*\* \| (\d+) \|/gm)];
    expect(rows.length).toBeGreaterThan(0);
    const summed = rows.reduce((total, row) => total + Number(row[1]), 0);
    expect(summed).toBe(allTools.length);
  });

  it("README's per-service counts match the tools each service actually ships", () => {
    // A table can sum correctly while two rows are wrong in opposite
    // directions, so the sum above is necessary and not sufficient.
    const prefixes: Record<string, string> = {
      Gmail: "gmail_",
      Calendar: "calendar_",
      Contacts: "contacts_",
      Drive: "drive_",
      Sheets: "sheets_",
      Docs: "docs_",
      Slides: "slides_",
      Tasks: "tasks_",
    };
    const readme = read("README.md");
    for (const [service, prefix] of Object.entries(prefixes)) {
      const row = new RegExp(`^\\| \\*\\*${service}\\*\\* \\| (\\d+) \\|`, "m").exec(readme);
      expect(row, `README has no row for ${service}`).not.toBeNull();
      const actual = allTools.filter((t) => t.name.startsWith(prefix)).length;
      expect(Number(row![1]), `${service} row`).toBe(actual);
    }
  });

  it("the pinned patterns still match a known-bad string, so the guard cannot go blind", () => {
    // A regex guard that stops matching passes for the wrong reason and reads
    // as protection. This asserts the patterns still find what they look for.
    expect(/\*\*(\d+) tools total\.\*\*/.test("**99 tools total.**")).toBe(true);
    expect(/expose (\d+) tools/.test("expose 99 tools")).toBe(true);
    expect(/^\| \*\*\w+\*\* \| (\d+) \|/m.test("| **Sheets** | 99 | read |")).toBe(true);
  });
});
