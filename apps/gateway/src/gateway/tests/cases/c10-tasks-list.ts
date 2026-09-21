import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * C10 (tier 2): the tasks read path answers with a list shape.
 *
 * Same design as C9: empty is a fair answer, the shape is not.
 */
export const c10TasksList: TestCase = {
  id: "C10",
  title: "tasks answers the first page with a list shape",
  tier: 2,
  covers: ["gws-mcp__tasks_list"],
  accounts: ["sender"],
  run: async (ctx) => {
    const result = await ctx.call("gws-mcp__tasks_list", {}, { as: "sender" });
    const list = firstArray(resultJson("tasks_list", result));
    if (list === null) {
      throw new Error("tasks_list answered without a list anywhere in it, so a caller cannot iterate the result");
    }
    ctx.evidence(`tasks answered a list of ${list.length}`);
  },
};
