import type { TestCase } from "../types";
import { firstArray, resultJson, resultText } from "../result-json";

/**
 * E16 (smoke row E16, tier 1): several messages labelled in ONE call, and
 * every one of them really carries it.
 *
 * Guards the change that let `gmail_label_message` take several ids at once.
 * The failure a batch write hides is partial success: the first id lands,
 * the rest are dropped, and the response says ok. So each message is read
 * back individually, and the response is required to say HOW MANY it
 * modified rather than merely that it worked.
 *
 * DEVIATION FROM THE SMOKE ROW, and it is about this repository being
 * public: the row picks three messages by an internal label name. This case
 * takes any three from the acting account's own mailbox instead. The claim
 * is about batching, not about which messages, and a label we use
 * internally has no business in a public file.
 */
export const e16BatchLabel: TestCase = {
  id: "E16",
  title: "three messages labelled in one call all carry it, and lose it together",
  tier: 1,
  covers: [
    "gws-mcp__gmail_search",
    "gws-mcp__gmail_create_label",
    "gws-mcp__gmail_label_message",
    "gws-mcp__gmail_read",
    "gws-mcp__gmail_delete_label",
  ],
  accounts: ["sender"],
  run: async (ctx) => {
    const found = await ctx.call(
      "gws-mcp__gmail_search",
      { query: "in:anywhere", max_results: 3 },
      { as: "sender" }
    );
    const messages = (firstArray(resultJson("gmail_search", found)) ?? []) as { id?: string }[];
    const ids = messages.map((m) => m.id).filter((id): id is string => typeof id === "string");
    if (ids.length < 3) throw new Error(`only ${ids.length} message(s) available, so a batch of three cannot be tested`);

    const created = await ctx.call(
      "gws-mcp__gmail_create_label",
      { name: `[smoke]/batch-${ctx.stamp}` },
      { as: "sender" }
    );
    const labelId = resultJson<{ id?: string }>("gmail_create_label", created).id;
    if (!labelId) throw new Error("gmail_create_label returned no id");
    ctx.defer("delete the batch label", async () => {
      await ctx.call("gws-mcp__gmail_delete_label", { label_id: labelId }, { as: "sender" });
    });

    const carries = async (messageId: string) => {
      const res = await ctx.call("gws-mcp__gmail_read", { message_id: messageId }, { as: "sender" });
      return resultText(res).includes(labelId);
    };

    const added = await ctx.call(
      "gws-mcp__gmail_label_message",
      { message_ids: ids, add_labels: [labelId] },
      { as: "sender" }
    );
    const addBody = resultJson<{ results?: { id?: string; ok?: boolean; error?: string }[] }>(
      "gmail_label_message",
      added
    );
    ctx.defer("remove the label from every message", async () => {
      await ctx.call(
        "gws-mcp__gmail_label_message",
        { message_ids: ids, remove_labels: [labelId] },
        { as: "sender" }
      );
    });

    // THE RESPONSE REPORTS PER MESSAGE, which is better than a count: the
    // tool returns results[] with id and ok precisely so a partial batch is
    // visible, and that is the thing worth asserting.
    const results = addBody.results ?? [];
    const failed = results.filter((r) => r.ok !== true);
    ctx.evidence(`the batch reported ${results.length} outcome(s), ${failed.length} not ok`);
    if (results.length !== ids.length) {
      throw new Error(`asked to label ${ids.length} messages and got ${results.length} outcomes back, so the batch is not reporting per message`);
    }
    if (failed.length > 0) {
      throw new Error(`${failed.length} of ${ids.length} messages were not modified, which a bare ok would have hidden`);
    }

    for (const id of ids) {
      if (!(await carries(id))) {
        throw new Error("a message in the batch does not carry the label, so the call succeeded only partially");
      }
    }
    ctx.evidence("all three carry the label");

    await ctx.call(
      "gws-mcp__gmail_label_message",
      { message_ids: ids, remove_labels: [labelId] },
      { as: "sender" }
    );
    for (const id of ids) {
      if (await carries(id)) {
        throw new Error("a message still carries the label after a batch removal that reported success");
      }
    }
    ctx.evidence("all three lost it in one call");
  },
};
