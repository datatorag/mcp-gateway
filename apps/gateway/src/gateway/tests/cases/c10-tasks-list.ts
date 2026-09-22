import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * C10: the tasks read path answers with a list shape.
 *
 * Same design as C9, and it carried the same defect: `firstArray`
 * answers null for `{}`, so an account with no tasklists failed a case
 * whose description says empty is a fair answer.
 */
export const c10TasksList: TestCase = {
  id: "C10",
  title: "tasks answers the first page with a list shape",
  covers: ["gws-mcp__tasks_list"],
  accounts: ["sender"],
  run: async (ctx) => {
    const answered = resultJson<{ items?: unknown }>(
      "tasks_list",
      await ctx.call("gws-mcp__tasks_list", {}, { as: "sender" })
    );
    /* AN OBJECT FIRST. Reading a key off a scalar yields `undefined`, and
     * the absent-means-empty rule below would then call a bare string or a
     * number "a list of 0" in green. `firstArray` used to refuse those, so
     * without this the fix would MASK a shape the old code caught, in the
     * commit whose title says a green must mean the shape was read. A BARE
     * ARRAY is refused too: these endpoints answer an object, so a list at
     * the top level is a changed shape, and reading zero rows from it would
     * be a green with the wrong count. */
    if (typeof answered !== "object" || answered === null || Array.isArray(answered)) {
      throw new Error("tasks_list answered with something that is not an object, so no list can be read from it");
    }
    /* AN ERROR BODY IS NOT AN EMPTY ONE. DEFENSIVE ONLY, and an earlier
     * comment here called it the realistic reachable path, which it is
     * not: the plugin's transport throws on any non-2xx and the server
     * wraps that as `isError`, which `resultJson` already refuses. A raw
     * `{error: {...}}` would have to arrive some other way. Kept because it
     * costs nothing and the shape is unmistakable.
     *
     * WHAT IS STILL TREATED AS EMPTY, and this is a real red-to-green
     * against `firstArray`: an object carrying neither the field nor an
     * `error`. Two different things live in that class. Google's own empty
     * answer is one, and cannot be refused without reddening the legitimate
     * case. A RENAMED OR RESTRUCTURED FIELD is the other, and it is not
     * benign: a body like `{wrong: [row, row]}` reads as "0" here, where
     * `firstArray` would have found the rows and reported the real count.
     * The bare-array guard above refuses a changed shape for exactly that
     * reason; this one cannot, because it cannot tell the two apart. */
    if ("error" in (answered as Record<string, unknown>)) {
      throw new Error("tasks_list answered with an error body rather than a list");
    }
    /* ABSENT MEANS EMPTY, as in C9 and for the same reason: `tasks_list` is
     * `tasklists.list` passed through, and Google's JSON omits a repeated
     * field at its default, so an account with NO TASKLISTS would have
     * failed the case whose description says empty is a fair answer. What
     * is refused is an `items` that is present and is not a list. */
    if (answered.items !== undefined && !Array.isArray(answered.items)) {
      throw new Error("tasks_list answered with an items field that is not a list, so a caller cannot iterate the result");
    }
    const list = (answered.items ?? []) as unknown[];
    ctx.evidence(`tasks answered a list of ${list.length}`);
  },
};
