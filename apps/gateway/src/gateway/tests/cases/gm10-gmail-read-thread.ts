import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type ThreadAnswer = {
  thread_id?: string;
  depth?: string;
  message_count?: number;
  messages?: { id?: string; date?: string; body?: string | null; in_trash?: boolean; is_draft?: boolean }[];
  left_out?: unknown;
};

/**
 * GM10 (Gmail scenario, SCRUM-491): `gmail_read_thread` answers a whole
 * conversation in one call, oldest to newest. It reads D12's conversation in
 * the sender's mailbox, which holds at least two messages: D10's original as
 * sent and D12's reply to it. D12 has put its reply in Trash by now, which
 * the answer marks rather than hides.
 *
 * Both depths are read. Full must carry the reply's body with D12's token;
 * headers must carry the same messages in the same order and no body.
 * Nothing is created, so there is nothing to clean up.
 */
export const gm10GmailReadThread: TestCase = {
  id: "GM10",
  title: "a whole thread reads in one call, oldest to newest",
  covers: ["gws-mcp__gmail_read_thread"],
  accounts: ["sender"],
  needs: ["D12"],
  run: async (ctx) => {
    const from = ctx.from("D12") as { threadId?: string; sentId?: string; replyId?: string; token?: string };
    if (!from.threadId || !from.sentId || !from.replyId || !from.token) {
      throw new Error("D12 shared no thread, so there is no conversation to read");
    }

    const full = resultJson<ThreadAnswer>(
      "gmail_read_thread",
      await ctx.call("gws-mcp__gmail_read_thread", { thread_id: from.threadId }, { as: "sender" })
    );
    const messages = full.messages ?? [];
    const ids = messages.map((m) => m.id);
    ctx.evidence(
      `full: ${full.message_count} message(s), ${messages.filter((m) => m.in_trash).length} in Trash, ${messages.filter((m) => m.is_draft).length} draft(s)`
    );
    if (full.thread_id !== from.threadId) throw new Error("the answer names a different thread");
    if (full.message_count !== messages.length) throw new Error("message_count disagrees with the messages answered");
    if (messages.length < 2) throw new Error(`the thread answered ${messages.length} message(s); the original and its reply make at least two`);

    const sentAt = ids.indexOf(from.sentId);
    const replyAt = ids.indexOf(from.replyId);
    if (sentAt < 0 || replyAt < 0) throw new Error("the original or the reply is missing from the thread");
    if (sentAt > replyAt) throw new Error("the reply is answered before the message it replied to");
    const times = messages.map((m) => Date.parse(m.date ?? ""));
    if (times.some((t, i) => i > 0 && !Number.isNaN(t) && !Number.isNaN(times[i - 1]) && t < times[i - 1])) {
      throw new Error("the messages are not oldest to newest by their Date headers");
    }
    const replyBody = messages[replyAt].body;
    if (typeof replyBody !== "string" || !replyBody.includes(from.token)) {
      throw new Error("the reply's body is not in the full answer");
    }

    const light = resultJson<ThreadAnswer>(
      "gmail_read_thread",
      await ctx.call("gws-mcp__gmail_read_thread", { thread_id: from.threadId, depth: "headers" }, { as: "sender" })
    );
    const lightIds = (light.messages ?? []).map((m) => m.id);
    ctx.evidence(`headers: ${lightIds.length} message(s), same order as full: ${JSON.stringify(lightIds) === JSON.stringify(ids)}`);
    if (JSON.stringify(lightIds) !== JSON.stringify(ids)) throw new Error("depth headers answered different messages or a different order");
    if ((light.messages ?? []).some((m) => "body" in m)) throw new Error("depth headers answered a body");
  },
};
