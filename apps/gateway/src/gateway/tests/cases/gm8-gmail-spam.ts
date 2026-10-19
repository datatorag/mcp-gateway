import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Spam = { message_id?: string; in_spam?: boolean; labelIds?: string[] };

/**
 * GM8 (Gmail scenario, SCRUM-428): `gmail_mark_spam` moves a message to spam
 * and out of the inbox, and `gmail_unmark_spam` moves it back, by Gmail's own
 * account of the labels each time.
 *
 * It rides on the message D10 delivered, which D10's cleanup has put in
 * Trash. The message is taken out of Trash first so the spam move starts from
 * the inbox, and the step ends with it back in Trash, which is also the
 * deferred cleanup. The runner's guard holds every one of these tools to mail
 * whose subject carries this run's stamp, so only D10's message can be moved.
 */
export const gm8GmailSpam: TestCase = {
  id: "GM8",
  title: "spam takes a message out of the inbox and not spam brings it back",
  covers: ["gws-mcp__gmail_mark_spam", "gws-mcp__gmail_unmark_spam", "gws-mcp__gmail_untrash", "gws-mcp__gmail_trash", "gws-mcp__gws_run"],
  accounts: ["reader"],
  needs: ["D10"],
  run: async (ctx) => {
    const message_id = ctx.from("D10").receivedId as string;
    if (!message_id) throw new Error("D10 shared no delivered message, so there is nothing to move");

    const labels = async (): Promise<string[]> => {
      const res = await ctx.call(
        "gws-mcp__gws_run",
        { service: "gmail", resource: "users.messages", method: "get", params: { userId: "me", id: message_id, format: "minimal" } },
        { as: "reader" }
      );
      return (resultJson<{ labelIds?: string[] }>("gws_run", res).labelIds ?? []).map(String);
    };

    ctx.defer("leave the message in Trash", async () => {
      if (!(await labels()).includes("TRASH")) await ctx.call("gws-mcp__gmail_trash", { message_id }, { as: "reader" });
    });

    if ((await labels()).includes("TRASH")) await ctx.call("gws-mcp__gmail_untrash", { message_id }, { as: "reader" });
    // Untrash restores a message's labels but not always INBOX, so the start
    // is made known: in the inbox, not in spam.
    const start = await labels();
    ctx.evidence(`before: ${JSON.stringify(start)}`);
    if (start.includes("TRASH") || start.includes("SPAM")) throw new Error("the message could not be brought to a known start");

    const marked = resultJson<Spam>("gmail_mark_spam", await ctx.call("gws-mcp__gmail_mark_spam", { message_id }, { as: "reader" }));
    const afterSpam = await labels();
    ctx.evidence(`after spam the tool says in_spam=${String(marked.in_spam)} and Gmail lists ${JSON.stringify(afterSpam)}`);
    if (!afterSpam.includes("SPAM") || afterSpam.includes("INBOX")) throw new Error("after mark_spam the message is not in spam and out of the inbox");
    if (marked.in_spam !== true) throw new Error("the mark_spam answer does not say the message is in spam");

    const unmarked = resultJson<Spam>("gmail_unmark_spam", await ctx.call("gws-mcp__gmail_unmark_spam", { message_id }, { as: "reader" }));
    const afterNotSpam = await labels();
    ctx.evidence(`after not spam the tool says in_spam=${String(unmarked.in_spam)} and Gmail lists ${JSON.stringify(afterNotSpam)}`);
    if (afterNotSpam.includes("SPAM") || !afterNotSpam.includes("INBOX")) throw new Error("after unmark_spam the message is not back in the inbox");
    if (unmarked.in_spam !== false) throw new Error("the unmark_spam answer does not say the message left spam");

    await ctx.call("gws-mcp__gmail_trash", { message_id }, { as: "reader" });
  },
};
