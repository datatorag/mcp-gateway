import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * C4: Drive search resolves the fixture folder's contents.
 *
 * Every Sheets, Docs and Slides path resolves through Drive, so this failing
 * predicts a wide blast radius and is worth its own alarm rather than being
 * inferred from whichever of those fails first.
 *
 * It searches BY PARENT and asserts a known child, which is stronger than a
 * search by name: a name search proves the query ran, and a parent search
 * proves it resolved the id the rest of the suite depends on.
 */
export const c4DriveSearch: TestCase = {
  id: "C4",
  title: "drive search lists the fixture folder and finds the fixture doc in it",
  covers: ["gws-mcp__drive_search"],
  accounts: ["sender"],
  fixtures: ["folder", "doc"],
  run: async (ctx) => {
    const folder = ctx.fixture("folder");
    const result = await ctx.call(
      "gws-mcp__drive_search",
      { query: `'${folder}' in parents and trashed=false` },
      { as: "sender" }
    );
    const files = firstArray(resultJson("drive_search", result)) ?? [];
    ctx.evidence(`the fixture folder listed ${files.length} file(s)`);

    if (files.length === 0) {
      throw new Error("the fixture folder came back empty, so Drive reads are broken or the folder id is wrong");
    }
    const ids = new Set(files.map((f) => (f as { id?: string }).id));
    if (!ids.has(ctx.fixture("doc"))) {
      throw new Error("the fixture doc is not among the folder's children, so the search did not resolve the folder the rest of the suite reads");
    }
  },
};
