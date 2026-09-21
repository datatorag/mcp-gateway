import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * GM2 (Gmail scenario): listing is BOUNDED, and a filter that matches
 * nothing returns nothing.
 *
 * A new step. `gmail_list` had no case, and the two ways it can be wrong
 * are both invisible from a successful response.
 *
 * A list that ignores `max_results` hands a caller a mailbox when they
 * asked for three, which in an agent context means a context window spent
 * on mail nobody wanted.
 *
 * A filter that matches nothing and returns EVERYTHING is the more
 * dangerous one, and it is the same shape as the scope defect this suite
 * spent a night on: a request that narrows coming back wider than it went.
 * Asserted here because a filter is only useful if its failure is empty
 * rather than total.
 */
export const gm2GmailList: TestCase = {
  id: "GM2",
  title: "listing is bounded, and a label that matches nothing returns nothing",
  covers: [
    "gws-mcp__gmail_list",
    "gws-mcp__gmail_create_label",
    "gws-mcp__gmail_delete_label",
    "gws-mcp__gmail_list_labels",
  ],
  accounts: ["reader"],
  run: async (ctx) => {
    const rowsOf = async (args: Record<string, unknown>): Promise<unknown[]> => {
      const res = await ctx.call("gws-mcp__gmail_list", args, { as: "reader" });
      return (firstArray(resultJson("gmail_list", res)) ?? []) as unknown[];
    };

    const three = await rowsOf({ max_results: 3 });
    ctx.evidence(`asked for at most 3, got ${three.length}`);
    if (three.length > 3) {
      throw new Error(`max_results was ignored: asked for 3 and got ${three.length}`);
    }
    /* THE MAILBOX MUST NOT BE EMPTY, or every assertion here is vacuous:
     * "at most three" and "none with that label" are both satisfied by a
     * tool that returns nothing to anybody. */
    if (three.length === 0) {
      throw new Error("the reader mailbox listed no messages at all, so nothing below can distinguish a filter from a failure");
    }

    const one = await rowsOf({ max_results: 1 });
    ctx.evidence(`asked for at most 1, got ${one.length}`);
    /* AT MOST, not exactly. Gmail treats `maxResults` as a page-size hint,
     * so demanding exactly one turns a pagination quirk into a red against
     * the product. The claim worth making is that the bound is respected. */
    if (one.length > 1) {
      throw new Error(`max_results was ignored: asked for at most 1 and got ${one.length}`);
    }

    /* A LABEL THAT EXISTS AND NOTHING CARRIES.
     *
     * Not an invented name: `label` is handed to Gmail as `labelIds`, which
     * takes IDs and refuses an unknown one, so a made-up string produces an
     * ERROR and a red accusing the product of widening a filter it never
     * applied. The probe has to be a real, empty label, which means making
     * one. */
    const emptyLabel = `smoke-empty-${ctx.stamp}`.slice(0, 40);

    /* REGISTERED BEFORE THE CREATE AND KEYED BY NAME, the same way GM1 does
     * it, because two cases in one scenario disagreeing about a pattern one
     * of them documents as load-bearing is how the pattern stops being
     * followed. Registering after the create cannot clean up a create that
     * succeeded upstream and answered without an id; deleting by a captured
     * id means a retry's second defer 404s and marks the case leaked over
     * a label that is already gone. Looking the name up each time is
     * idempotent under both. */
    ctx.defer("remove the empty label", async () => {
      const res = await ctx.call("gws-mcp__gmail_list_labels", {}, { as: "reader" });
      const rows = (firstArray(resultJson("gmail_list_labels", res)) ?? []) as { id?: string; name?: string }[];
      for (const row of rows) {
        if (row.id && row.name === emptyLabel) {
          await ctx.call("gws-mcp__gmail_delete_label", { label_id: row.id }, { as: "reader" });
        }
      }
    });

    const made = await ctx.call("gws-mcp__gmail_create_label", { name: emptyLabel }, { as: "reader" });
    const labelId = resultJson<{ id?: string }>("gmail_create_label", made).id;
    if (!labelId) {
      throw new Error("creating a label answered without an id, so the filter cannot be exercised");
    }

    const absent = await rowsOf({ label: labelId, max_results: 5 });
    ctx.evidence(`a real label nothing carries returned ${absent.length} message(s)`);
    if (absent.length > 0) {
      throw new Error(
        `filtering by a label no message carries returned ${absent.length} messages, so the filter widened instead of narrowing`
      );
    }
  },
};
