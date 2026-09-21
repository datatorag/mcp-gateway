import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * GM3 (Gmail scenario): marking a message read really clears UNREAD, and
 * marking it unread puts it back.
 *
 * A new step. `gmail_mark_read` had no case, and "it returned success" is
 * not the claim: the tool's whole job is to change a label, so the only
 * evidence that it worked is the label. A handler that answered without
 * touching the message would be indistinguishable from a working one, and
 * a user would find out by continuing to see bold rows in their inbox.
 *
 * BOTH DIRECTIONS, because a tool that simply strips UNREAD from anything
 * it is handed would pass the first half. The second half puts the message
 * back the way it was found, which is also the cleanup: this step reads a
 * message D10 delivered and must leave it exactly as it was.
 *
 * WHERE THAT MESSAGE IS BY NOW: D10's own cleanup runs when D10 ends, and
 * it trashes the message it sent, so this step works on a message already
 * in Trash. Every call here behaves the same on a trashed message, so the
 * claims hold, but "as it was found" means as it was found IN TRASH. Said
 * plainly because the docblock would otherwise promise something about an
 * inbox the message has already left.
 */
export const gm3GmailMarkRead: TestCase = {
  id: "GM3",
  title: "marking read clears UNREAD, and marking unread restores it",
  covers: [
    "gws-mcp__gmail_mark_read",
    /* THE ADD DIRECTION GOES THROUGH A DIFFERENT TOOL, and that is a fact
     * about the plugin rather than a preference. `gmail_mark_read` sets
     * `removeLabelIds` to ["UNREAD"] whenever `remove_labels` is absent,
     * EVEN IF `add_labels` was supplied, so asking it to add UNREAD sends
     * add and remove of the same label in one modify. `gmail_label_message`
     * has no such default and is the honest way to put a message back.
     * (The plugin's own schema text says that default applies only when
     * neither list is given; the code disagrees. Reported separately.) */
    "gws-mcp__gmail_label_message",
    "gws-mcp__gws_run",
  ],
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
    ctx.evidence(`the message starts with ${started.length} label(s), unread=${startedUnread}`);

    /* REGISTERED BEFORE THE FIRST MUTATION. Registering after it leaves a
     * window where a throw between the change and the registration orphans
     * the change in a real mailbox.
     *
     * On a transient retry the runner re-runs this body with the same ctx,
     * so a second defer is registered. Undos run in REVERSE, so the first
     * attempt's defer runs last, and it is the one holding the true
     * original state. That ordering is load-bearing, not incidental. */
    ctx.defer("leave the message as it was found", async () => {
      await (startedUnread
        ? ctx.call("gws-mcp__gmail_label_message", { message_id: messageId, add_labels: ["UNREAD"] }, { as: "reader" })
        : ctx.call("gws-mcp__gmail_mark_read", { message_id: messageId, remove_labels: ["UNREAD"] }, { as: "reader" }));
    });

    // A known state first, so the assertion does not depend on how the
    // message happened to arrive.
    await ctx.call("gws-mcp__gmail_label_message", { message_id: messageId, add_labels: ["UNREAD"] }, { as: "reader" });

    const unread = await labels();
    if (!unread.includes("UNREAD")) {
      throw new Error("the message could not be put into an unread state, so the next assertion proves nothing");
    }

    await ctx.call("gws-mcp__gmail_mark_read", { message_id: messageId, remove_labels: ["UNREAD"] }, { as: "reader" });
    const read = await labels();
    ctx.evidence(`after marking read, unread=${read.includes("UNREAD")}`);
    if (read.includes("UNREAD")) {
      throw new Error("the message still carries UNREAD after being marked read, so the call did nothing");
    }

    /* THE REST OF THE LABELS SURVIVED. A handler that replaced the label
     * set rather than removing one member would clear UNREAD and quietly
     * strip INBOX, and the message would vanish from the mailbox while this
     * step reported success. */
    const lost = unread.filter((l) => l !== "UNREAD" && !read.includes(l));
    if (lost.length > 0) {
      throw new Error(`marking read also removed ${lost.join(", ")}, so it replaced the labels rather than changing one`);
    }
  },
};
