import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * CF3 (Confluence scenario): a page listing of the fixture space answers,
 * and any row it returns is addressable.
 *
 * `confluence_list_pages` resolves a space KEY to a space id first, so this
 * step covers that resolution as much as the listing: a key that did not
 * resolve would fail here rather than somewhere later with a confusing id.
 *
 * THE ASSERTION IS THAT EVERY ROW IS ADDRESSABLE, not that a particular
 * page is present. Naming a page would pin somebody's space layout into a
 * public repo and would go red the day it is reorganised. An empty space is
 * a fact about the space and not a fault, so it is reported rather than
 * failed; a connector that could not reach Confluence throws instead.
 *
 * No page title is printed: titles in this space are our own internal
 * documents.
 */
export const cf3ConfluenceList: TestCase = {
  id: "CF3",
  title: "a page listing of the fixture space answers, and any row it returns is addressable",
  covers: ["atlassian-mcp__confluence_list_pages"],
  accounts: ["atlassian"],
  fixtures: ["confluenceSpace"],
  run: async (ctx) => {
    /* `?? []` WOULD HAVE MADE THIS UNFALSIFIABLE. A response `firstArray`
     * cannot read would have become a passing "0 page(s)", indistinguishable
     * from an empty space, in the one step this scenario relies on as its
     * canary. Empty is a fair answer; an unreadable shape is not. C9 and C10
     * already did it this way and JR2, which this first copied, does not. */
    const listed = firstArray(
      resultJson(
        "confluence_list_pages",
        await ctx.call(
          "atlassian-mcp__confluence_list_pages",
          { space_key: ctx.fixture("confluenceSpace"), limit: 10 },
          { as: "atlassian" }
        )
      )
    );
    if (listed === null) {
      throw new Error("confluence_list_pages answered without a list anywhere in it, so a caller cannot iterate the result");
    }
    const pages = listed as { id?: string }[];
    ctx.evidence(`the space listed ${pages.length} page(s)`);

    const unaddressable = pages.filter((p) => !p.id);
    if (unaddressable.length > 0) {
      throw new Error(
        `${unaddressable.length} of ${pages.length} listed pages carry no id, so a caller cannot open or edit them`
      );
    }
  },
};
