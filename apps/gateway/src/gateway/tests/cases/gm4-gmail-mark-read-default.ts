import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * GM4 (Gmail scenario): `gmail_mark_read` removes UNREAD only when it is
 * given no labels at all, and with labels given it applies exactly those.
 *
 * A regression guard with a proven failure. The tool used to remove UNREAD
 * whenever `remove_labels` was absent, EVEN IF `add_labels` was supplied, so
 * a caller who asked only to star a message also had it marked read, and
 * nothing in the answer said so. GM3 never saw it because GM3 always names
 * the label it removes.
 *
 * TWO HALVES, AND THE SECOND IS THE CONTROL FOR THE FIRST. "Still unread
 * after add_labels alone" would also be the result of a tool that never
 * removes UNREAD on its own, so the second call, with no labels, must clear
 * it. Each half fails a different broken handler.
 *
 * The label added is STARRED because it changes nothing about where the
 * message lives, and it is taken off again in the same run. Like GM3, this
 * works on the message D10 delivered, which is in Trash by now; label
 * changes behave the same there.
 */
export const gm4GmailMarkReadDefault: TestCase = {
  id: "GM4",
  title: "mark_read with labels given applies only those, and with none it clears UNREAD",
  covers: ["gws-mcp__gmail_mark_read", "gws-mcp__gmail_label_message", "gws-mcp__gws_run"],
  accounts: ["reader"],
  needs: ["D10"],
  run: async (ctx) => {
    const messageId = ctx.from("D10").receivedId as string;
    if (!messageId) {
      throw new Error("D10 shared no delivered message, so there is nothing to mark");
    }

    /** The labels Gmail currently has on that message. */
    const labels = async (): Promise<string[]> => {
      const res = await ctx.call(
        "gws-mcp__gws_run",
        {
          service: "gmail",
          resource: "users.messages",
          method: "get",
          params: { userId: "me", id: messageId, format: "minimal" },
        },
        { as: "reader" }
      );
      return (resultJson<{ labelIds?: string[] }>("gws_run", res).labelIds ?? []).map(String);
    };

    const started = await labels();
    const startedUnread = started.includes("UNREAD");
    const startedStarred = started.includes("STARRED");
    ctx.evidence(`the message starts unread=${startedUnread}, starred=${startedStarred}`);

    // Registered before the first mutation, and through gmail_label_message,
    // which has no default of its own, so the undo cannot depend on the
    // behaviour under test.
    ctx.defer("leave the message as it was found", async () => {
      await ctx.call(
        "gws-mcp__gmail_label_message",
        {
          message_id: messageId,
          ...(startedUnread ? { add_labels: ["UNREAD"] } : { remove_labels: ["UNREAD"] }),
        },
        { as: "reader" }
      );
      if (!startedStarred) {
        await ctx.call("gws-mcp__gmail_label_message", { message_id: messageId, remove_labels: ["STARRED"] }, { as: "reader" });
      }
    });

    // A known state first: unread and not starred.
    await ctx.call(
      "gws-mcp__gmail_label_message",
      { message_id: messageId, add_labels: ["UNREAD"], remove_labels: ["STARRED"] },
      { as: "reader" }
    );
    const before = await labels();
    if (!before.includes("UNREAD") || before.includes("STARRED")) {
      throw new Error("the message could not be put into an unread, unstarred state, so the assertions prove nothing");
    }

    await ctx.call("gws-mcp__gmail_mark_read", { message_id: messageId, add_labels: ["STARRED"] }, { as: "reader" });
    const starred = await labels();
    ctx.evidence(`after add_labels alone: starred=${starred.includes("STARRED")}, unread=${starred.includes("UNREAD")}`);
    if (!starred.includes("STARRED")) {
      throw new Error("add_labels was given and the label is not on the message, so the call did nothing");
    }
    if (!starred.includes("UNREAD")) {
      throw new Error("asked only to add a label, the call also marked the message read");
    }

    await ctx.call("gws-mcp__gmail_mark_read", { message_id: messageId }, { as: "reader" });
    const read = await labels();
    ctx.evidence(`after no labels: unread=${read.includes("UNREAD")}, starred=${read.includes("STARRED")}`);
    if (read.includes("UNREAD")) {
      throw new Error("with no labels given the message is still unread, so the default never applies");
    }
    if (!read.includes("STARRED")) {
      throw new Error("marking read also removed STARRED, so it replaced the labels rather than changing one");
    }
  },
};
