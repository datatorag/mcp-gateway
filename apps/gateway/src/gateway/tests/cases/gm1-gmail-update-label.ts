import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * GM1 (Gmail scenario): a renamed label answers to its new name and stops
 * answering to the old one.
 *
 * A new step. `gmail_update_label` had no case, and the failure worth
 * catching is the one a rename-as-copy produces: the caller sees the new
 * name, does not notice the original is still there, and every later count
 * of their labels is one too high. So the old name must be GONE, asserted
 * from the same listing that proves the new one arrived, which is the only
 * way the two claims are about the same moment.
 */
export const gm1GmailUpdateLabel: TestCase = {
  id: "GM1",
  title: "a renamed label answers to its new name and not its old one",
  covers: [
    "gws-mcp__gmail_update_label",
    "gws-mcp__gmail_create_label",
    "gws-mcp__gmail_list_labels",
    "gws-mcp__gmail_delete_label",
  ],
  accounts: ["sender"],
  run: async (ctx) => {
    const before = `smoke-before-${ctx.stamp}`.slice(0, 40);
    const after = `smoke-after-${ctx.stamp}`.slice(0, 40);

    /** Every label name this account currently has, with its id. */
    const listing = async (): Promise<{ id?: string; name?: string }[]> => {
      const res = await ctx.call("gws-mcp__gmail_list_labels", {}, { as: "sender" });
      return (firstArray(resultJson("gmail_list_labels", res)) ?? []) as { id?: string; name?: string }[];
    };

    /* REGISTERED BEFORE THE CREATE, and by NAME rather than by id. A defer
     * registered after the call cannot clean up a create that succeeded
     * upstream and then answered without an id, which is exactly the case
     * the next line throws on. Deleting by whichever of the two stamped
     * names is present also survives the rename this case exists to test. */
    ctx.defer("remove the label under whichever name it ends up with", async () => {
      const rows = await listing();
      for (const row of rows) {
        if (row.id && (row.name === before || row.name === after)) {
          await ctx.call("gws-mcp__gmail_delete_label", { label_id: row.id }, { as: "sender" });
        }
      }
    });

    const created = await ctx.call("gws-mcp__gmail_create_label", { name: before }, { as: "sender" });
    const labelId = resultJson<{ id?: string }>("gmail_create_label", created).id;
    if (!labelId) throw new Error("creating a label answered without an id, so nothing can be renamed");

    const names = async (): Promise<string[]> => (await listing()).map((r) => String(r.name ?? ""));

    const started = await names();
    if (!started.includes(before)) {
      throw new Error("the label that was just created is not in the listing, so the rename would prove nothing");
    }

    await ctx.call("gws-mcp__gmail_update_label", { label_id: labelId, name: after }, { as: "sender" });

    const ended = await names();
    ctx.evidence(`labels went from ${started.length} to ${ended.length}`);
    if (!ended.includes(after)) {
      throw new Error("the renamed label is not listed under its new name, so the rename did not take");
    }
    if (ended.includes(before)) {
      throw new Error("the old label name is still listed, so the rename left a copy rather than moving it");
    }
    // A rename must not change how many labels exist. One that added rather
    // than moved would satisfy both checks above if the old name differed
    // only in case or whitespace.
    if (ended.length !== started.length) {
      throw new Error(`renaming changed the label count from ${started.length} to ${ended.length}`);
    }
  },
};
