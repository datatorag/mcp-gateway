import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type ThreadMessages = { messages?: { id?: string; labelIds?: string[] }[] };
type ThreadMoved = { thread_id?: string; message_count?: number; messages?: { message_id?: string; in_trash?: boolean }[] };

/**
 * GM9 (Gmail scenario, SCRUM-428): the thread-level actions. A label added
 * with `gmail_label_message` and a thread_id lands on every message of the
 * conversation and comes off the same way; `gmail_untrash_thread` and
 * `gmail_trash_thread` move the whole conversation, by Gmail's own account of
 * each message's labels.
 *
 * It rides on D10's message and its conversation in the reader mailbox, which
 * D10's cleanup has put in Trash. The label is STARRED, a system label, so
 * nothing is created. The step ends with the thread in Trash and unstarred,
 * which is also the deferred cleanup. The runner's guard allows the thread
 * moves only when every message in the thread carries this run's stamp, read
 * at the moment of the call.
 */
export const gm9GmailThread: TestCase = {
  id: "GM9",
  title: "a label and a trash on a thread reach every message in it",
  covers: [
    "gws-mcp__gmail_label_message",
    "gws-mcp__gmail_untrash_thread",
    "gws-mcp__gmail_trash_thread",
    "gws-mcp__gws_run",
  ],
  accounts: ["reader"],
  needs: ["D10"],
  run: async (ctx) => {
    const message_id = ctx.from("D10").receivedId as string;
    if (!message_id) throw new Error("D10 shared no delivered message, so there is no thread");
    const meta = resultJson<{ threadId?: string }>(
      "gws_run",
      await ctx.call(
        "gws-mcp__gws_run",
        { service: "gmail", resource: "users.messages", method: "get", params: { userId: "me", id: message_id, format: "minimal" } },
        { as: "reader" }
      )
    );
    const thread_id = meta.threadId;
    if (!thread_id) throw new Error("the delivered message carries no thread id");

    const messages = async () =>
      (
        resultJson<ThreadMessages>(
          "gws_run",
          await ctx.call(
            "gws-mcp__gws_run",
            { service: "gmail", resource: "users.threads", method: "get", params: { userId: "me", id: thread_id, format: "minimal" } },
            { as: "reader" }
          )
        ).messages ?? []
      ).map((m) => (m.labelIds ?? []).map(String));
    const all = (rows: string[][], label: string) => rows.length > 0 && rows.every((l) => l.includes(label));
    const none = (rows: string[][], label: string) => rows.every((l) => !l.includes(label));

    ctx.defer("leave the thread unstarred and in Trash", async () => {
      const rows = await messages();
      if (!none(rows, "STARRED")) {
        await ctx.call("gws-mcp__gmail_label_message", { thread_id, remove_labels: ["STARRED"] }, { as: "reader" });
      }
      if (!all(await messages(), "TRASH")) await ctx.call("gws-mcp__gmail_trash_thread", { thread_id }, { as: "reader" });
    });

    const start = await messages();
    ctx.evidence(`the thread holds ${start.length} message(s); in Trash: ${all(start, "TRASH")}`);
    if (!all(start, "TRASH")) {
      await ctx.call("gws-mcp__gmail_trash_thread", { thread_id }, { as: "reader" });
      if (!all(await messages(), "TRASH")) throw new Error("the thread could not be put in Trash to begin with");
    }

    const restored = resultJson<ThreadMoved>(
      "gmail_untrash_thread",
      await ctx.call("gws-mcp__gmail_untrash_thread", { thread_id }, { as: "reader" })
    );
    const afterUntrash = await messages();
    ctx.evidence(`after untrash_thread: ${restored.message_count} message(s) answered, none in Trash: ${none(afterUntrash, "TRASH")}`);
    if (!none(afterUntrash, "TRASH")) throw new Error("a message of the thread still carries TRASH after untrash_thread");
    if ((restored.messages ?? []).some((m) => m.in_trash !== false)) throw new Error("the untrash_thread answer does not say every message left Trash");

    await ctx.call("gws-mcp__gmail_label_message", { thread_id, add_labels: ["STARRED"] }, { as: "reader" });
    const starred = await messages();
    ctx.evidence(`after starring the thread, every message starred: ${all(starred, "STARRED")}`);
    if (!all(starred, "STARRED")) throw new Error("a thread-level label did not reach every message");
    await ctx.call("gws-mcp__gmail_label_message", { thread_id, remove_labels: ["STARRED"] }, { as: "reader" });
    if (!none(await messages(), "STARRED")) throw new Error("a thread-level unlabel did not reach every message");

    const trashed = resultJson<ThreadMoved>(
      "gmail_trash_thread",
      await ctx.call("gws-mcp__gmail_trash_thread", { thread_id }, { as: "reader" })
    );
    const afterTrash = await messages();
    ctx.evidence(`after trash_thread: every message in Trash: ${all(afterTrash, "TRASH")}`);
    if (!all(afterTrash, "TRASH")) throw new Error("a message of the thread is not in Trash after trash_thread");
    if (trashed.thread_id !== thread_id) throw new Error("the trash_thread answer names a different thread");
  },
};
