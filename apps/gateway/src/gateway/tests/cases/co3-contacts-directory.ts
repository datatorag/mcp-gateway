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
    /* AN OBJECT FIRST. Reading a key off a scalar yields `undefined`, and
     * the absent-means-empty rule below would then call a bare string or a
     * number "a list of 0" in green. `firstArray` used to refuse those, so
     * without this the fix would MASK a shape the old code caught, in the
     * commit whose title says a green must mean the shape was read. A BARE
     * ARRAY is refused too: these endpoints answer an object, so a list at
     * the top level is a changed shape, and reading zero rows from it would
     * be a green with the wrong count. */
    if (typeof answered !== "object" || answered === null || Array.isArray(answered)) {
      throw new Error("contacts_directory_search answered with something that is not an object, so no list can be read from it");
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
      throw new Error("contacts_directory_search answered with an error body rather than a list");
    }
    /* AN UNREADABLE RESPONSE MUST NOT READ AS AN EMPTY ONE: the per-row
     * check below is this case's ONLY assertion.
     *
     * BUT ABSENT MEANS EMPTY HERE, for the same reason as CO2: Google's
     * JSON omits a repeated field at its default, so a missing `people` and
     * an empty one are the same answer, and a small domain matching nothing
     * is a fair outcome. What is refused is a key that is present and is
     * not a list. */
    if (answered.people !== undefined && !Array.isArray(answered.people)) {
      throw new Error("contacts_directory_search answered with a people field that is not a list, so no row can be checked");
    }
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
