import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type SearchResults = { results?: { person?: { resourceName?: string } }[] };

/**
 * CO2 (Contacts scenario): searching your own contacts answers addressably.
 *
 * WHAT THIS DOES NOT DO IS LOOK FOR CO1'S CONTACT, and that is deliberate
 * rather than an omission. `contacts_search` goes through the People API's
 * SEARCH INDEX, which is asynchronous: a record created a moment ago is not
 * reliably findable, and the same API wants a warm-up call before it
 * answers at all. A case that required the new contact would go red on a
 * connector that is working, at a rate nobody can predict, which is the
 * kind of red that gets a suite switched off. CO1 proves the record exists
 * by addressing it directly.
 *
 * SO THIS STEP IS THIN, AND THINNER THAN ITS FIRST DRAFT ADMITTED. That
 * draft called an empty answer a possibility. It is the EXPECTED path: this
 * makes no warm-up call, and the only `[smoke]` contact in the book is the
 * one CO1 deletes, so the per-row check below will normally run over
 * nothing. What this step actually proves on most runs is that
 * `contacts_search` answers an authorized call with parseable JSON, which
 * is more than the contract probe shows and less than the title of a
 * "search" step suggests.
 *
 * The per-row check is kept for the runs where the book does hold a match:
 * every row must carry a person with a resource name, so a caller can act
 * on a hit. A tool that could not reach Google throws instead, which
 * `resultJson` turns into a red in the tool's own words.
 *
 * NOTHING ABOUT A PERSON IS PRINTED. These are somebody's contacts.
 */
export const co2ContactsSearch: TestCase = {
  id: "CO2",
  title: "a contact search answers, and any row it returns is addressable",
  covers: ["gws-mcp__contacts_search"],
  accounts: ["sender"],
  run: async (ctx) => {
    const answered = resultJson<SearchResults>(
      "contacts_search",
      await ctx.call("gws-mcp__contacts_search", { query: "[smoke]", max_results: 5 }, { as: "sender" })
    );
    const rows = answered.results ?? [];
    ctx.evidence(`the search answered with ${rows.length} row(s)`);

    const unaddressable = rows.filter((r) => !r.person?.resourceName);
    if (unaddressable.length > 0) {
      throw new Error(
        `${unaddressable.length} of ${rows.length} search rows carry no person resource name, so a caller cannot act on the hit`
      );
    }
  },
};
