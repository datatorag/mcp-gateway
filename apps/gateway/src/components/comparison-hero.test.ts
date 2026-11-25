import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GROUPS, heroGroups, unmappedHeroGaps } from "./connector-comparison";

/**
 * The hero is the comparison table's short form, and it may hold nothing the
 * table does not: every row in it is a row of GROUPS, word for word, that we
 * have and Anthropic's help page does not describe (`builtIn: false`, which
 * is a statement about the page and never "the connectors cannot"). These
 * hold that it is derived, not retyped, by changing the source and watching
 * the hero follow.
 */

const sourceRows = GROUPS.flatMap((g) => g.rows.map((r) => ({ ...r, service: g.service })));
const clone = () => GROUPS.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r })) }));

describe("the comparison hero's rows", () => {
  it("are exactly the rows of the table that the help page does not describe and we have", () => {
    const hero = heroGroups().flatMap((g) => g.rows.map((r) => r.capability));
    const expected = sourceRows.filter((r) => !r.builtIn && r.ours).map((r) => r.capability);
    expect([...hero].sort()).toEqual([...expected].sort());
    expect(hero).toHaveLength(6);
  });

  it("places every gap row: none falls outside the map", () => {
    expect(unmappedHeroGaps()).toEqual([]);
    // A row newly of this kind that the map does not place is caught, not
    // silently left out of the hero.
    const groups = clone();
    groups.find((g) => g.service === "Google Drive")!.rows.find((r) => r.capability === "Upload a file")!.builtIn = false;
    expect(unmappedHeroGaps(groups)).toEqual(["Upload a file"]);
  });

  it("sits in three groups, in order", () => {
    // Five until November 25, 2026. The Slides and Calendar groups held one
    // row each ("Put content in it", "Free/busy lookup"), both of which the
    // vendor's page contradicts, and a group with no row is not shown.
    expect(heroGroups().map((g) => [g.label, g.rows.map((r) => r.capability)])).toEqual([
      ["Sheets", ["Query a sheet with a filter"]],
      [
        "Gmail attachments",
        ["Save an email or an attachment to Drive", "Save an email or an attachment to your computer"],
      ],
      [
        "Contacts, Tasks, and accounts",
        ["Google Contacts", "Google Tasks", "Several Google accounts behind one connection"],
      ],
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
    const contacts = groups.flatMap((g) => g.rows).find((r) => r.capability === "Google Contacts")!;
    contacts.ours = false;
    expect(heroGroups(groups).flatMap((g) => g.rows).map((r) => r.capability)).not.toContain("Google Contacts");
  });

  it("carries, under each group, every Yes/Yes row of its source groups, in the table's order", () => {
    const sources: Record<string, string[]> = {
      Sheets: ["Google Sheets"],
      "Gmail attachments": ["Gmail"],
      "Contacts, Tasks, and accounts": [],
    };
    for (const g of heroGroups()) {
      const expected = sources[g.label].flatMap((s) =>
        GROUPS.find((x) => x.service === s)!.rows.filter((r) => r.builtIn && r.ours).map((r) => r.short ?? r.capability)
      );
      expect(g.ties, g.label).toEqual(expected);
    }
    expect(heroGroups().find((g) => g.label === "Sheets")!.ties).toEqual(["read", "create", "edit"]);
    // The last group draws from no source group. Its ties were the Jira and
    // Confluence rows, which left the table with the enumeration they rested
    // on: the vendor page the table is read from covers Google only.
    expect(heroGroups().find((g) => g.label === "Contacts, Tasks, and accounts")!.ties).toEqual([]);
  });

  it("names every tie by its short label, or its full label when it has none", () => {
    // Every Yes/Yes row of a mapped source group is in a tie line, as
    // `short ?? capability`; a row losing its short label still appears.
    const groups = clone();
    const forward = groups.find((g) => g.service === "Gmail")!.rows.find((r) => r.capability === "Forward")!;
    expect(heroGroups(groups).find((g) => g.label === "Gmail attachments")!.ties).toContain("forward");
    delete (forward as { short?: string }).short;
    expect(heroGroups(groups).find((g) => g.label === "Gmail attachments")!.ties).toContain("Forward");
    // The separator never appears inside a name.
    for (const t of heroGroups().flatMap((g) => g.ties)) expect(t).not.toContain(" · ");
    // Only Yes/Yes rows carry a short label: it is a tie-line name, nothing else.
    for (const r of GROUPS.flatMap((g) => g.rows)) {
      if ((r as { short?: string }).short !== undefined) expect(r.builtIn && r.ours, r.capability).toBe(true);
    }
  });

  it("never puts a row we lose in a tie line, and a tie that stops being one leaves it", () => {
    const allTies = heroGroups().flatMap((g) => g.ties);
    const losses = GROUPS.flatMap((g) => g.rows).filter((r) => r.builtIn && !r.ours).map((r) => r.capability);
    for (const l of losses) expect(allTies, l).not.toContain(l);
    const groups = clone();
    groups.find((g) => g.service === "Gmail")!.rows.find((r) => r.capability === "Forward")!.ours = false;
    expect(heroGroups(groups).find((g) => g.label === "Gmail attachments")!.ties).not.toContain("forward");
  });

  it("has one to three rows in every group, and no empty group", () => {
    for (const g of heroGroups()) {
      expect(g.rows.length, g.label).toBeGreaterThanOrEqual(1);
      expect(g.rows.length, g.label).toBeLessThanOrEqual(3);
    }
  });

  it("drops a group whose every row is conceded, rather than showing an empty one", () => {
    const groups = clone();
    groups.find((g) => g.service === "Google Sheets")!.rows.forEach((r) => (r.builtIn = true));
    expect(heroGroups(groups).map((g) => g.label)).toEqual(["Gmail attachments", "Contacts, Tasks, and accounts"]);
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
