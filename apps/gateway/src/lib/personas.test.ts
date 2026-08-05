import { describe, expect, it } from "vitest";
import { getAllPersonas, skillsForPersona } from "./personas";
import { getAllSkills } from "./skills";

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
      const shipped = new Set(getAllSkills().map((s) => s.slug));
      const dangling = persona.skillSlugs.filter((s) => !shipped.has(s));
      expect(dangling, `${persona.slug} references unshipped skills`).toEqual([]);
    }
  );

  it.each(personas.map((p) => [p.slug, p] as const))(
    "%s resolves to a non-empty skill list",
    (_slug, persona) => {
      expect(skillsForPersona(persona).length).toBeGreaterThan(0);
    }
  );

  it.each(personas.map((p) => [p.slug, p] as const))(
    "%s has the copy every surface renders",
    (_slug, persona) => {
      // The home page renders title + situation, the persona page adds the
      // intro, and metadata needs metaTitle. A blank one ships an empty card.
      expect(persona.title).not.toBe("");
      expect(persona.situation).not.toBe("");
      expect(persona.metaTitle).not.toBe("");
      expect(persona.introHtml).not.toBe("");
    }
  );

  it("has no duplicate order values, so the home page slice is deterministic", () => {
    const orders = personas.map((p) => p.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  /** The home page shows a subset. It must be a subset of THIS set — a card
   * that exists only there is how the site ends up sorting readers by two
   * different taxonomies, which is the problem the layer was built to fix. */
  it("covers every skill at least once", () => {
    const referenced = new Set(personas.flatMap((p) => p.skillSlugs));
    const orphans = getAllSkills()
      .map((s) => s.slug)
      .filter((slug) => !referenced.has(slug));
    expect(orphans, "skills no persona routes anyone to").toEqual([]);
  });
});
