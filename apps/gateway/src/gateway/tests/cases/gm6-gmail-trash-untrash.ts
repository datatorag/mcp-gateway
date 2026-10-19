import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Moved = { message_id?: string; in_trash?: boolean; labelIds?: string[] };

/**
 * GM6 (Gmail scenario): `gmail_untrash` takes a message out of Trash and
 * `gmail_trash` puts it back, and Gmail agrees both times.
 *
 * It rides on the message D10 delivered. D10's own cleanup has already
 * trashed it, so the message is found IN TRASH, and this step ends by
 * leaving it there: untrash first, then trash. That order is also the
 * cleanup, and the deferred undo trashes again in case the step dies in
 * between, so a failure cannot leave live mail in the reader inbox.
 *
 * The labels are read through a second call, never taken from the tool's
 * own answer alone. "It returned in_trash false" is what a handler that
 * did nothing could also say.
 *
 * The runner's guard holds both tools to mail this run sent: the stored
 * subject has to carry the smoke prefix and this run's stamp. That is why
 * this step can only ever move D10's message.
 */
export const gm6GmailTrashUntrash: TestCase = {
  id: "GM6",
  title: "untrash removes the Trash label and trash puts it back, by Gmail's own account",
  covers: ["gws-mcp__gmail_trash", "gws-mcp__gmail_untrash", "gws-mcp__gws_run"],
  accounts: ["reader"],
  needs: ["D10"],
  run: async (ctx) => {
    const message_id = ctx.from("D10").receivedId as string;
    if (!message_id) throw new Error("D10 shared no delivered message, so there is nothing to move");

    /** The labels Gmail currently has on that message. */
    const labels = async (): Promise<string[]> => {
      const res = await ctx.call(
        "gws-mcp__gws_run",
        {
          service: "gmail",
          resource: "users.messages",
          method: "get",
          params: { userId: "me", id: message_id, format: "minimal" },
        },
        { as: "reader" }
      );
      return (resultJson<{ labelIds?: string[] }>("gws_run", res).labelIds ?? []).map(String);
    };

    const started = (await labels()).includes("TRASH");
    ctx.evidence(`the message starts in Trash: ${started}`);

    // Registered before the first move. Whatever happens below, the
    // message ends in Trash, which is where a run's mail belongs.
    ctx.defer("leave the message in Trash", async () => {
      if (!(await labels()).includes("TRASH")) {
        await ctx.call("gws-mcp__gmail_trash", { message_id }, { as: "reader" });
      }
    });

    // A known state first, so the untrash below is tested on a message
    // that is in Trash however this step found it.
    if (!started) {
      await ctx.call("gws-mcp__gmail_trash", { message_id }, { as: "reader" });
      if (!(await labels()).includes("TRASH")) {
        throw new Error("the message could not be put in Trash to begin with, so the untrash below proves nothing");
      }
    }

    const restored = resultJson<Moved>(
      "gmail_untrash",
      await ctx.call("gws-mcp__gmail_untrash", { message_id }, { as: "reader" })
    );
    const afterRestore = await labels();
    ctx.evidence(`after untrash the tool says in_trash=${String(restored.in_trash)} and Gmail lists TRASH: ${afterRestore.includes("TRASH")}`);
    if (afterRestore.includes("TRASH")) throw new Error("the message still carries TRASH after an untrash that answered");
    if (restored.in_trash !== false) throw new Error("the untrash answer does not say the message is out of Trash");

    const trashed = resultJson<Moved>(
      "gmail_trash",
      await ctx.call("gws-mcp__gmail_trash", { message_id }, { as: "reader" })
    );
    const afterTrash = await labels();
    ctx.evidence(`after trash the tool says in_trash=${String(trashed.in_trash)} and Gmail lists TRASH: ${afterTrash.includes("TRASH")}`);
    if (!afterTrash.includes("TRASH")) throw new Error("the message does not carry TRASH after a trash that answered");
    if (trashed.in_trash !== true) throw new Error("the trash answer does not say the message is in Trash");
    if (trashed.message_id !== message_id) throw new Error("the trash answer names a different message than the one asked for");
  },
};
