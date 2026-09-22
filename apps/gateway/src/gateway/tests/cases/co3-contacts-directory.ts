import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type DirectoryResults = { people?: { resourceName?: string }[] };

/**
 * CO3 (Contacts scenario): the org directory read answers addressably.
 *
 * THIS READS REAL COLLEAGUES. `contacts_directory_search` asks the domain
 * profile source, so every row is a person at the company. The case
 * therefore asserts only that a row can be acted on, counts the rows, and
 * prints nothing else: no name, no address, no resource name. This repo is
 * public and the evidence is stored.
 *
 * IT IS A READ AND STAYS ONE. There is no directory write in the connector
 * and this step must never become the place somebody adds one.
 *
 * AN EMPTY ANSWER IS NOT A FAILURE. The query matches against directory
 * profiles, and a domain with no match for it is a fact about the domain.
 * A tool that could not reach Google throws instead. The title says "any
 * row it returns" for that reason: on a small domain this step can prove
 * only that the endpoint answered.
 */
export const co3ContactsDirectory: TestCase = {
  id: "CO3",
  title: "an org directory search answers, and any row it returns is addressable",
  covers: ["gws-mcp__contacts_directory_search"],
  accounts: ["sender"],
  run: async (ctx) => {
    const answered = resultJson<DirectoryResults>(
      "contacts_directory_search",
      await ctx.call(
        "gws-mcp__contacts_directory_search",
        { query: "a", max_results: 5 },
        { as: "sender" }
      )
    );
    const rows = answered.people ?? [];
    ctx.evidence(`the directory answered with ${rows.length} row(s)`);

    const unaddressable = rows.filter((p) => !p.resourceName);
    if (unaddressable.length > 0) {
      throw new Error(
        `${unaddressable.length} of ${rows.length} directory rows carry no resource name, so a caller cannot act on the hit`
      );
    }
  },
};
