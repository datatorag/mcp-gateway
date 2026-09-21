import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * E1 (smoke row E1): creating a label answers with the label's ID.
 *
 * A regression guard. A create that returns success but no id leaves the
 * caller with nothing to label anything WITH, and the failure surfaces one
 * call later somewhere that looks unrelated. Asserting the id is present is
 * the whole point; the label is removed again in the same run.
 *
 * It touches no message and reads no mail: a label is a container, and
 * creating an empty one is the cheapest possible exercise of the write path.
 */
export const e1GmailLabel: TestCase = {
  id: "E1",
  title: "creating a label answers with the label id, and the label is removed",
  covers: ["gws-mcp__gmail_create_label", "gws-mcp__gmail_delete_label", "gws-mcp__gmail_list_labels"],
  accounts: ["sender"],
  run: async (ctx) => {
    const name = `[smoke]/${ctx.stamp}`;

    const created = await ctx.call("gws-mcp__gmail_create_label", { name }, { as: "sender" });
    const labelId = resultJson<{ id?: string }>("gmail_create_label", created).id;
    ctx.evidence(`create answered with an id: ${labelId ? "yes" : "no"}`);
    if (!labelId) {
      throw new Error("gmail_create_label reported success without an id, so nothing can use the label");
    }

    let deleted = false;
    ctx.defer("delete the created label", async () => {
      if (deleted) return;
      await ctx.call("gws-mcp__gmail_delete_label", { label_id: labelId }, { as: "sender" });
    });

    await ctx.call("gws-mcp__gmail_delete_label", { label_id: labelId }, { as: "sender" });
    deleted = true;

    const labels = await ctx.call("gws-mcp__gmail_list_labels", {}, { as: "sender" });
    const text = labels.content.map((c) => c.text ?? "").join("");
    if (text.includes(labelId)) {
      throw new Error("the label is still listed after a delete that reported success");
    }
    ctx.evidence("the mailbox no longer lists it, so the delete really removed it");
  },
};
