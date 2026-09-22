import type { TestCase } from "../types";
import { firstArray, resultJson, resultText } from "../result-json";

type Hit = { slug?: string; title?: string; layer?: string };
type Written = { slug?: string; layer?: string; forked?: boolean; forkedFrom?: unknown };

/**
 * SK2 (Skills scenario): forking a published skill shadows it, and deleting
 * the fork gives it back.
 *
 * THIS STEP TEMPORARILY CHANGES WHAT A PUBLISHED SKILL MEANS FOR THIS USER,
 * which no other case in the suite does. `skills_fork` keeps the published
 * SLUG on purpose, so the copy runs in the original's place; until the copy
 * is deleted, the account owner's own `skills_get` for that slug answers
 * with our copy. The delete is therefore not tidiness, it is the second
 * half of the behaviour, and a cleanup that fails leaves somebody with a
 * smoke-suite copy of a real skill. That is what the RESIDUE line is for.
 *
 * THE FORK TARGET IS CHOSEN, NOT NAMED. A literal slug would pin the
 * catalogue's contents into a public repo and would go red the day a skill
 * is renamed. The search picks the first hit that is NOT already ours,
 * because forking something already forked is a different path.
 *
 * THE SHADOW IS ASSERTED THROUGH THE CATALOGUE, not through the fork's own
 * answer. `skills_fork` reports what it did; the question is whether the
 * catalogue now says that slug is yours, and whether it stops saying so
 * after the delete. A restored layer is the only evidence the published
 * skill actually came back.
 */
export const sk2SkillsFork: TestCase = {
  id: "SK2",
  title: "forking a published skill shadows it, and deleting the fork restores it",
  covers: ["skills_search", "skills_fork", "skills_delete"],
  accounts: [],
  timeoutMs: 120_000,
  run: async (ctx) => {
    /** The catalogue as this caller sees it: every row, and the readable
     * ones by slug. BOTH COUNTS ARE KEPT, because the builder used to drop
     * slug-less rows silently, so a renamed `slug` emptied the map and the
     * red downstream said the catalogue had nothing to fork. The shape
     * check below cannot see a row the builder has already thrown away. */
    const catalogue = async (): Promise<{ rows: Hit[]; bySlug: Map<string, Hit> }> => {
      const listed = firstArray(
        resultJson("skills_search", await ctx.call("skills_search", { query: "" }))
      );
      if (listed === null) {
        throw new Error("skills_search answered without a list anywhere in it, so the catalogue cannot be read");
      }
      const rows = listed as Hit[];
      return { rows, bySlug: new Map(rows.filter((h) => h.slug).map((h) => [h.slug as string, h])) };
    };

    const before = await catalogue();
    ctx.evidence(`the catalogue answered ${before.rows.length} row(s), ${before.bySlug.size} of them addressable`);

    /* A ROW THIS CASE CANNOT READ IS NOT A CATALOGUE WITH NOTHING TO FORK.
     * The first version mixed the two in one predicate (`slug` and `layer`
     * and `layer !== "yours"`), so a renamed field made every row unusable
     * while the red told the reader to go publish a skill. The second
     * version split them but counted only rows the BUILDER had already
     * kept, and the builder drops slug-less rows, so a renamed `slug` still
     * reached the catalogue red with "0 of 0". It counts the raw rows now. */
    const readable = before.rows.filter((h) => h.slug && h.layer);
    if (before.rows.length > 0 && readable.length === 0) {
      throw new Error(
        `the catalogue answered ${before.rows.length} row(s) and none carries both a slug and a layer, so this is the shape of the answer rather than the catalogue's contents`
      );
    }

    const target = readable.find((h) => h.layer !== "yours");
    if (!target?.slug) {
      // A CATALOGUE problem, named as one: nothing here is forkable.
      throw new Error(
        `no published skill is available to fork (${readable.length} readable of ${before.rows.length} answered, none outside your own layer), so this step has nothing to work on`
      );
    }
    const slug = target.slug;
    const originalLayer = target.layer;

    const forked = resultJson<Written>("skills_fork", await ctx.call("skills_fork", { slug }));
    if (forked.forked !== true) {
      throw new Error("skills_fork answered without reporting a fork, so nothing was copied");
    }
    let deleted = false;
    ctx.defer("delete the forked copy", async () => {
      if (deleted) return;
      const gone = await ctx.call("skills_delete", { slug });
      if (/^No skill of yours named/.test(resultText(gone).trim())) {
        ctx.evidence("RESIDUE: the forked copy was already gone at cleanup, so the published skill's state is unverified");
      }
    });

    if (forked.slug !== slug) {
      throw new Error("the fork did not keep the published slug, so it will not run in the original's place");
    }
    if (forked.layer !== "yours") {
      throw new Error(`the fork landed in the ${JSON.stringify(forked.layer ?? null)} layer, not yours`);
    }

    const shadowed = (await catalogue()).bySlug.get(slug);
    if (shadowed?.layer !== "yours") {
      throw new Error(
        `after the fork the catalogue still reports that slug as ${JSON.stringify(shadowed?.layer ?? null)}, so the copy is not running in the published skill's place`
      );
    }

    const removed = resultText(await ctx.call("skills_delete", { slug })).trim();
    if (/^No skill of yours named/.test(removed)) {
      throw new Error("skills_delete reported there was no copy of ours, immediately after the catalogue showed one");
    }
    deleted = true;

    /* THE PUBLISHED SKILL MUST COME BACK. A delete that removed the copy
     * AND the original would satisfy any assertion that only checked the
     * copy was gone, and would be the worst outcome this step could miss. */
    const restored = (await catalogue()).bySlug.get(slug);
    if (!restored) {
      throw new Error("after deleting the fork the published skill is gone from the catalogue entirely, so the delete took both");
    }
    if (restored.layer !== originalLayer) {
      throw new Error(
        `after deleting the fork the slug reports layer ${JSON.stringify(restored.layer ?? null)}, not the ${JSON.stringify(originalLayer ?? null)} it had before`
      );
    }
    ctx.evidence("the published skill was shadowed by the fork and restored by the delete");
  },
};
