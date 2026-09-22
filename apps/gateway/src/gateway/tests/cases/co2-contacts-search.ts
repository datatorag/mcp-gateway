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
    /* AN OBJECT FIRST. Reading a key off a scalar yields `undefined`, and
     * the absent-means-empty rule below would then call a bare string or a
     * number "a list of 0" in green. `firstArray` used to refuse those, so
     * without this the fix would MASK a shape the old code caught, in the
     * commit whose title says a green must mean the shape was read. A BARE
     * ARRAY is refused too: these endpoints answer an object, so a list at
     * the top level is a changed shape, and reading zero rows from it would
     * be a green with the wrong count. */
    if (typeof answered !== "object" || answered === null || Array.isArray(answered)) {
      throw new Error("contacts_search answered with something that is not an object, so no list can be read from it");
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
      throw new Error("contacts_search answered with an error body rather than a list");
    }
    /* AN UNREADABLE RESPONSE MUST NOT READ AS AN EMPTY ONE: with `?? []`
     * the per-row check below, this case's ONLY assertion, passed on a shape
     * it could not parse.
     *
     * BUT ABSENT MEANS EMPTY HERE. The tool hands back Google's payload
     * unchanged and Google's JSON omits a repeated field at its default, so
     * a missing `results` and an empty one are THE SAME ANSWER. Requiring
     * the key would have reddened this case on every run, since empty is
     * its expected path. What is refused is a key that is present and is
     * not a list. */
    if (answered.results !== undefined && !Array.isArray(answered.results)) {
      throw new Error("contacts_search answered with a results field that is not a list, so no row can be checked");
    }
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
