import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GROUPS, heroGroups, unmappedHeroGaps } from "./connector-comparison";

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
  it("are exactly the rows of the table that are No for built-in and Yes for us", () => {
    const hero = heroGroups().flatMap((g) => g.rows.map((r) => r.capability));
    const expected = sourceRows.filter((r) => !r.builtIn && r.ours).map((r) => r.capability);
    expect([...hero].sort()).toEqual([...expected].sort());
    expect(hero).toHaveLength(10);
  });

  it("places every gap row: none falls outside the map", () => {
    expect(unmappedHeroGaps()).toEqual([]);
    // A row newly flipped to No/Yes that the map does not place is caught,
    // not silently left out of the hero.
    const groups = clone();
    groups.find((g) => g.service === "Google Drive")!.rows.find((r) => r.capability === "Download file content")!.builtIn = false;
    groups.find((g) => g.service === "Google Drive")!.rows.find((r) => r.capability === "Download file content")!.ours = true;
    expect(unmappedHeroGaps(groups)).toEqual(["Download file content"]);
  });

  it("sits in Manuel's five groups, in his order", () => {
    expect(heroGroups().map((g) => [g.label, g.rows.map((r) => r.capability)])).toEqual([
      ["Sheets", ["Query a sheet with a filter", "Two Google accounts in one request"]],
      [
        "Gmail attachments",
        [
          "Save an email or an attachment to Drive",
          "Save an email or an attachment to your computer",
          "Jira, attach an email or one of its attachments to an issue",
        ],
      ],
      ["Slides", ["Put content in it"]],
      ["Calendar", ["Free/busy lookup"]],
      ["Beyond Google", ["Google Contacts", "Google Tasks", "Work and personal account at the same time"]],
    ]);
  });

  it("tags only the Jira row, whose group does not name its service", () => {
    const tagged = heroGroups().flatMap((g) => g.rows).filter((r) => r.tag !== null);
    expect(tagged.map((r) => [r.capability, r.tag])).toEqual([
      ["Jira, attach an email or one of its attachments to an issue", "Jira"],
    ]);
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

  it("has one to three rows in every group, and no empty group", () => {
    for (const g of heroGroups()) {
      expect(g.rows.length, g.label).toBeGreaterThanOrEqual(1);
      expect(g.rows.length, g.label).toBeLessThanOrEqual(3);
    }
  });

  it("drops a group whose every row is conceded, rather than showing an empty one", () => {
    const groups = clone();
    groups.find((g) => g.service === "Google Calendar")!.rows.forEach((r) => (r.builtIn = true));
    expect(heroGroups(groups).map((g) => g.label)).toEqual(["Sheets", "Gmail attachments", "Slides", "Beyond Google"]);
  });

  it("flags the Slides group for its own date, and stops when the Slides row goes", () => {
    expect(heroGroups().map((g) => g.slides)).toEqual([false, false, true, false, false]);
    const noSlides = clone();
    noSlides.find((g) => g.service === "Google Slides")!.rows.forEach((r) => (r.builtIn = true));
    expect(heroGroups(noSlides).some((g) => g.slides)).toBe(false);
  });

  it("the landing page no longer types rows of its own", () => {
    const page = readFileSync(join(__dirname, "../app/page.tsx"), "utf8");
    expect(page).toContain("heroGroups()");
    expect(page).not.toMatch(/capability: "/);
    expect(page).not.toContain("<HeroVideo");
  });

  it("the headline beside it never holds a phrase on one line at every width", () => {
    // A bare whitespace-nowrap in the H1 clipped it on every phone and, from
    // lg to xl, pushed this table off the right edge. The fit itself was
    // measured in a browser at 320 to 1440 (see the comment above the H1);
    // this only stops the unconditional form coming back.
    const page = readFileSync(join(__dirname, "../app/page.tsx"), "utf8");
    const h1 = page.slice(page.indexOf("<h1"), page.indexOf("</h1>"));
    expect(h1).not.toMatch(/className="[^"]*(?<![:\w-])whitespace-nowrap/);
    expect(h1).toContain("sm:max-lg:whitespace-nowrap");
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
