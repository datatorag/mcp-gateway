import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERSONA_MARK_LABELS, personaMarks } from "./persona-marks";
import { getAllPersonas, skillsForPersona } from "./personas";
import { readSkillFiles } from "./skills";

/** A persona is a claim about who something is for. The invariants here are
 * the ones that keep it from becoming a claim with nothing behind it. */
describe("personas", () => {
  const personas = getAllPersonas();

  it("ships some", () => {
    expect(personas.length).toBeGreaterThan(0);
  });

  it.each(personas.map((p) => [p.slug, p] as const))(
    "%s names only skills that exist",
    (_slug, persona) => {
      // The failure this catches is a page rendering with a hole in it: a
      // typo'd slug drops silently at render time, so the test is the only
      // place it is visible.
      const shipped = new Set(readSkillFiles().map((s) => s.slug));
      const dangling = persona.skillSlugs.filter((s) => !shipped.has(s));
      expect(dangling, `${persona.slug} references unshipped skills`).toEqual([]);
    }
  );

  it.each(personas.map((p) => [p.slug, p] as const))(
    "%s resolves to a non-empty skill list",
    async (_slug, persona) => {
      expect((await skillsForPersona(persona)).length).toBeGreaterThan(0);
    }
  );

  it.each(personas.map((p) => [p.slug, p] as const))(
    "%s has the copy every surface renders",
    (_slug, persona) => {
      // The home page renders title + situation, the persona page adds the
      // intro, and metadata needs metaTitle. A blank one ships an empty card.
      expect(persona.title).not.toBe("");
      expect(persona.situation).not.toBe("");
      // The site's menu shows this under the title on every public page
      // (SCRUM-506). A persona without one cannot ship: short, one line.
      expect(persona.menuLine, "menuLine").not.toBe("");
      expect(persona.menuLine.length, "menuLine is a short line").toBeLessThanOrEqual(48);
      // Its product marks in the menu (SCRUM-508). Empty means the file
      // names none, more than two, or one that is not in `persona-marks.ts`.
      expect(persona.marks.length, "marks: one or two names from persona-marks.ts").toBeGreaterThan(0);
      expect(persona.metaTitle).not.toBe("");
      expect(persona.introHtml).not.toBe("");
    }
  );

  it("gives each persona marks no other persona has, so no two rows of the menu's column look the same", () => {
    const tiles = personas.map((p) => p.marks.join("+"));
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  it("names only marks the site ships, and reads a bad list as no marks at all", () => {
    for (const mark of Object.keys(PERSONA_MARK_LABELS)) {
      expect(existsSync(join(import.meta.dirname, "../../public/icons/services", `${mark}.svg`)), mark).toBe(true);
    }
    expect(personaMarks(["gmail", "gmail"])).toEqual(["gmail", "gmail"]);
    expect(personaMarks([])).toEqual([]);
    expect(personaMarks(["gmail", "rocket"])).toEqual([]);
    expect(personaMarks(["constructor"])).toEqual([]);
    expect(personaMarks(["gmail", "sheets", "jira"])).toEqual([]);
  });

  it("has no duplicate order values, so the home page slice is deterministic", () => {
    const orders = personas.map((p) => p.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  /** The home page shows a subset. It must be a subset of THIS set — a card
   * that exists only there is how the site ends up sorting readers by two
   * different taxonomies, which is the problem the layer was built to fix. */
  it("covers every skill at least once", () => {
    const referenced = new Set(personas.flatMap((p) => p.skillSlugs));
    const orphans = readSkillFiles()
      .map((s) => s.slug)
      .filter((slug) => !referenced.has(slug));
    expect(orphans, "skills no persona routes anyone to").toEqual([]);
  });
});
