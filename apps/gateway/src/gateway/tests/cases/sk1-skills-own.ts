import type { TestCase } from "../types";
import { resultJson, resultText } from "../result-json";

type Written = { slug?: string; version?: string; layer?: string; created?: boolean; updated?: boolean };

/**
 * SK1 (Skills scenario): a skill of your own is written, revised and removed.
 *
 * THESE ARE GATEWAY BUILT-INS, not a plugin, so they carry no `__` prefix
 * and need no connected account. They write to the caller's OWN skills, and
 * the caller here is whoever the run authenticates as.
 *
 * EVERY MISS IN THIS FAMILY ANSWERS WITH PROSE, NOT AN ERROR, and the
 * design leans on it rather than fighting it. `skills_get` on an unknown
 * slug deliberately returns the available slugs instead of failing, so a
 * model that guessed gets the real list; `skills_delete` on an unknown slug
 * says so in a sentence. Both come back with `isError` false. A case that
 * checked only for an error would read every miss as a hit, so the
 * assertions here read the TEXT: after the delete, the "No skill named"
 * sentence is the PROOF rather than the trap it was in CF4.
 *
 * THE WRITES ANSWER JSON ON SUCCESS AND PROSE ON FAILURE, so each write is
 * parsed and its own flag checked. A refused write would otherwise reach
 * `resultJson` as "did not answer JSON" and name the wrong problem.
 *
 * THE `tools` A SKILL DECLARES MUST BE REGISTRY TOOLS, and the first two
 * drafts of this case named `skills_search` and `skills_get`, which are
 * gateway BUILT-INS and are not in `REGISTRY_TOOL_NAMES`. `validateSkillInput`
 * refuses an unknown tool, so `skills_create` answered prose and the case
 * died on its first call, twice, with everything below it unreachable. The
 * names here are plugin tools, checked against the registry rather than
 * chosen because they read plausibly.
 *
 * A VERSION IS A CONTENT HASH, NOT A NUMBER, and an earlier draft of this
 * case had it as a number: it typed `version` as one, demanded `typeof
 * "number"`, and compared with `<=`. That throws on every run, so the case
 * could never pass, and had the type check been relaxed the comparison
 * would have been a lexicographic test on two SHA-256 prefixes, which is a
 * coin flip. The draft's own docblock called it a real guard, in a
 * paragraph contrasting it with CF1's unreachable one.
 *
 * WHAT MAKES THE CORRECTED CHECK WORTH HAVING: equal content is one
 * version, and `skills_update` returns ok WITH THE EXISTING ROW when the
 * content hashes the same. So `updated: true` on its own does not prove a
 * new version was written; only a DIFFERENT hash does. That is the guard.
 */
export const sk1SkillsOwn: TestCase = {
  id: "SK1",
  title: "a skill of your own is created, revised into a new version, and deleted",
  covers: ["skills_create", "skills_get", "skills_update", "skills_delete"],
  accounts: [],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const firstTitle = `[smoke] SK1 ${ctx.stamp}`;
    const secondTitle = `[smoke] SK1 revised ${ctx.stamp}`;
    const firstMark = `created-${ctx.stamp}`;
    const secondMark = `revised-${ctx.stamp}`;
    const body = (mark: string) => `# ${mark}\n\nA skill written by the smoke suite and deleted in the same run.\n`;

    const created = resultJson<Written>(
      "skills_create",
      await ctx.call("skills_create", { title: firstTitle, source: body(firstMark), tools: ["gmail_search"] })
    );
    if (created.created !== true) {
      throw new Error("skills_create answered without reporting a creation, so nothing was written");
    }
    const slug = created.slug;
    if (!slug) throw new Error("skills_create answered without a slug, so the skill cannot be read or removed");
    /* REGISTERED BEFORE THE LAYER CHECK BELOW. The first draft put this
     * after it, so a skill created into an unexpected layer threw with no
     * cleanup registered and leaked. SK2 had the ordering right. */
    let deleted = false;
    ctx.defer("delete the created skill", async () => {
      if (deleted) return;
      const gone = await ctx.call("skills_delete", { slug });
      if (/^No skill of yours named/.test(resultText(gone).trim())) {
        ctx.evidence("RESIDUE: the created skill was already gone at cleanup, so something else removed it");
      }
    });

    if (created.layer !== "yours") {
      throw new Error(`the created skill is in the ${JSON.stringify(created.layer ?? null)} layer, not yours`);
    }
    const firstVersion = created.version;

    /** The skill as `skills_get` renders it. Prose by design. */
    const shown = async () => resultText(await ctx.call("skills_get", { slug }));

    const afterCreate = await shown();
    if (/^No skill named/.test(afterCreate.trim())) {
      throw new Error("the skill just created cannot be found by its own slug");
    }
    if (!afterCreate.includes(firstMark)) {
      throw new Error("the created skill does not render the source it was created with");
    }

    const revised = resultJson<Written>(
      "skills_update",
      await ctx.call("skills_update", {
        slug,
        title: secondTitle,
        source: body(secondMark),
        tools: ["gmail_search", "drive_search"],
      })
    );
    if (revised.updated !== true) {
      throw new Error("skills_update answered without reporting an update, so nothing was saved");
    }
    /* PRESENCE FIRST, so a missing version fails rather than opting out of
     * its own check. Both are hashes, so only inequality is meaningful:
     * there is no order between them and nothing to advance. */
    if (typeof firstVersion !== "string" || firstVersion === "" || typeof revised.version !== "string" || revised.version === "") {
      throw new Error("a skill write answered without a version, so the saved version cannot be compared");
    }
    if (revised.version === firstVersion) {
      throw new Error(
        "the skill's version hash is unchanged after an update with different content, so no new version was stored"
      );
    }

    const afterUpdate = await shown();
    if (afterUpdate.includes(firstMark)) {
      throw new Error("the skill still renders its original source, so the update did not take");
    }
    if (!afterUpdate.includes(secondMark)) {
      throw new Error("the updated skill renders neither the source it was created with nor the one it was updated to");
    }
    ctx.evidence(`the skill's version hash changed across the update (${firstVersion.length} characters)`);

    const removed = resultText(await ctx.call("skills_delete", { slug })).trim();
    if (/^No skill of yours named/.test(removed)) {
      throw new Error("skills_delete reported there was no such skill of ours, immediately after we read it");
    }
    deleted = true;

    /* THE MISS SENTENCE IS THE PROOF. `skills_get` does not fail on an
     * unknown slug, by design, so absence has to be read rather than
     * inferred from an error that will never come. */
    const after = (await shown()).trim();
    if (!/^No skill named/.test(after)) {
      throw new Error("the deleted skill is still readable by its slug, so the delete was reported rather than made");
    }
    ctx.evidence("a get of the deleted skill answers that no such skill exists");
  },
};
