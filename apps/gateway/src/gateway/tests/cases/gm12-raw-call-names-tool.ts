import type { TestCase } from "../types";
import { NAMED_TOOL_LINE, resultJson } from "../result-json";

/**
 * GM12 (Gmail scenario, SCRUM-499): a raw `gws_run` call a named tool covers
 * answers with one leading line naming that tool, and the API's own answer
 * follows unchanged. A raw call no named tool covers answers exactly as before.
 *
 * It reads D12's conversation in the sender's mailbox through the raw thread
 * read, which `gmail_read_thread` covers, and the mailbox's own profile
 * through `users.getProfile`, which no named tool covers. Both are reads, so
 * nothing is created and there is nothing to clean up.
 */
export const gm12RawCallNamesTool: TestCase = {
  id: "GM12",
  title: "a raw thread read names gmail_read_thread, and a raw call no tool covers does not",
  covers: ["gws-mcp__gws_run"],
  accounts: ["sender"],
  needs: ["D12"],
  run: async (ctx) => {
    const from = ctx.from("D12") as { threadId?: string };
    if (!from.threadId) throw new Error("D12 shared no thread, so there is nothing to read");

    const covered = await ctx.call(
      "gws-mcp__gws_run",
      { service: "gmail", resource: "users.threads", method: "get", params: { userId: "me", id: from.threadId, format: "metadata" } },
      { as: "sender" }
    );
    const lead = covered.content[0]?.text ?? "";
    ctx.evidence(`the raw thread read answered ${covered.content.length} part(s), leading with: ${lead.slice(0, 120)}`);
    if (covered.isError) throw new Error(`the raw thread read failed: ${lead.slice(0, 200)}`);
    if (!NAMED_TOOL_LINE.test(lead) || !lead.startsWith("gmail_read_thread covers this call: ")) {
      throw new Error("the raw thread read did not lead with the line naming gmail_read_thread");
    }
    const thread = resultJson<{ id?: string; messages?: unknown[] }>("gws_run", covered);
    if (thread.id !== from.threadId || !Array.isArray(thread.messages) || thread.messages.length === 0) {
      throw new Error("after the line, the answer is not the API's own thread");
    }

    const uncovered = await ctx.call(
      "gws-mcp__gws_run",
      { service: "gmail", resource: "users", method: "getProfile", params: { userId: "me" } },
      { as: "sender" }
    );
    ctx.evidence(`the raw profile read answered ${uncovered.content.length} part(s)`);
    if (uncovered.content.some((c) => NAMED_TOOL_LINE.test(c.text ?? ""))) {
      throw new Error("the raw profile read named a tool, but no named tool covers it");
    }
    const profile = resultJson<{ emailAddress?: string }>("gws_run", uncovered);
    if (typeof profile.emailAddress !== "string") throw new Error("the raw profile read did not answer the API's own profile");
  },
};
