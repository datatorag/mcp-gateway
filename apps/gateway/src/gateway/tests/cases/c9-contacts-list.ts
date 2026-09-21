import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * C9 (tier 2): the contacts read path answers with a list shape.
 *
 * EMPTY IS ACCEPTABLE and that is the case's whole design. An account with
 * no contacts is a fair state of the world, so what is asserted is the
 * SHAPE: a list came back. A tool returning null or an error object would
 * fail; a tool returning zero contacts would not.
 */
export const c9ContactsList: TestCase = {
  id: "C9",
  title: "contacts answers the first page with a list shape",
  tier: 2,
  covers: ["gws-mcp__contacts_list"],
  accounts: ["sender"],
  run: async (ctx) => {
    const result = await ctx.call("gws-mcp__contacts_list", { max_results: 5 }, { as: "sender" });
    const list = firstArray(resultJson("contacts_list", result));
    if (list === null) {
      throw new Error("contacts_list answered without a list anywhere in it, so a caller cannot iterate the result");
    }
    ctx.evidence(`contacts answered a list of ${list.length}`);
  },
};
