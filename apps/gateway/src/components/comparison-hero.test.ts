import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GROUPS, heroGroups } from "./connector-comparison";

/**
 * The hero (SCRUM-425) is the comparison table's short claim, and it may hold
 * nothing the table does not: every row in it is a row of GROUPS, word for
 * word, that we have and the built-in connectors do not. These hold that it
 * is derived, not retyped, by changing the source and watching the hero
 * follow.
 */

const sourceRows = GROUPS.flatMap((g) => g.rows.map((r) => ({ ...r, service: g.service })));
const clone = () => GROUPS.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r })) }));

describe("the comparison hero's rows", () => {
  it("are exactly the rows of the table that are No for built-in and Yes for us, in the table's order", () => {
    const hero = heroGroups().flatMap((g) => g.rows.map((r) => r.capability));
    const expected = sourceRows.filter((r) => !r.builtIn && r.ours).map((r) => r.capability);
    expect(hero).toEqual(expected);
  });

  it("carry each source row's text and marks unchanged", () => {
    for (const row of heroGroups().flatMap((g) => g.rows)) {
      const source = sourceRows.find((r) => r.capability === row.capability);
      expect(source, row.capability).toBeDefined();
      expect({ builtIn: row.builtIn, ours: row.ours, emphasis: row.emphasis }).toEqual({
        builtIn: source!.builtIn,
        ours: source!.ours,
        emphasis: source!.emphasis,
      });
    }
  });

  it("never holds a Yes/Yes row: a row flipped in the table leaves the hero", () => {
    const groups = clone();
    const query = groups.flatMap((g) => g.rows).find((r) => r.capability === "Query a sheet with a filter")!;
    expect(heroGroups(groups).flatMap((g) => g.rows).map((r) => r.capability)).toContain(query.capability);
    query.builtIn = true;
    const after = heroGroups(groups).flatMap((g) => g.rows);
    expect(after.map((r) => r.capability)).not.toContain(query.capability);
    expect(after.every((r) => !r.builtIn && r.ours)).toBe(true);
  });

  it("never holds a row we lose either", () => {
    const groups = clone();
    const freeBusy = groups.flatMap((g) => g.rows).find((r) => r.capability === "Free/busy lookup")!;
    freeBusy.ours = false;
    expect(heroGroups(groups).flatMap((g) => g.rows).map((r) => r.capability)).not.toContain("Free/busy lookup");
  });

  it("has two to four rows in every group", () => {
    const groups = heroGroups();
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (const g of groups) {
      expect(g.rows.length, g.label).toBeGreaterThanOrEqual(2);
      expect(g.rows.length, g.label).toBeLessThanOrEqual(4);
    }
  });

  it("drops a group whose every row is conceded, rather than showing an empty one", () => {
    const groups = clone();
    for (const service of ["Gmail", "Google Calendar", "Google Drive"]) {
      groups.find((g) => g.service === service)!.rows.forEach((r) => (r.builtIn = true));
    }
    const hero = heroGroups(groups);
    expect(hero.map((g) => g.label)).toEqual(["Sheets and Slides", "Beyond Google"]);
    expect(hero.every((g) => g.rows.length > 0)).toBe(true);
  });

  it("labels a group by the services it shows a row for, and flags the Slides row for its own date", () => {
    const groups = heroGroups();
    expect(groups.map((g) => g.label)).toEqual(["Sheets and Slides", "Gmail and Calendar", "Beyond Google"]);
    expect(groups.map((g) => g.slides)).toEqual([true, false, false]);
    // A group that loses its Slides row stops naming Slides and stops asking
    // for the second date.
    const noSlides = clone();
    noSlides.find((g) => g.service === "Google Slides")!.rows.forEach((r) => (r.builtIn = true));
    const first = heroGroups(noSlides)[0];
    expect(first.label).toBe("Sheets");
    expect(first.slides).toBe(false);
  });

  it("the landing page no longer types rows of its own", () => {
    const page = readFileSync(join(__dirname, "../app/page.tsx"), "utf8");
    expect(page).toContain("heroGroups()");
    expect(page).not.toMatch(/capability: "/);
    expect(page).not.toContain("<HeroVideo");
  });

  it("contains no em-dashes, code comments included", () => {
    // The new file only: connector-comparison.tsx has older comments that
    // carry some, and the full table is out of this change's scope. Its rows
    // and notes are held by the comparison suite's own check.
    for (const file of ["comparison-hero.tsx"]) {
      expect(readFileSync(join(__dirname, file), "utf8"), file).not.toContain(String.fromCharCode(0x2014));
    }
  });
});
