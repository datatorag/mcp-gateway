import type { TestCase } from "../types";

/**
 * A2 (Gateway scenario): an MCP client can complete a handshake and call a tool.
 *
 * The LIVE TOOL CALL is the assertion, not an analytics event. The sheet's
 * original version required a session event inside the run window, which was
 * unsatisfiable on a quiet day: a session emits that event once per
 * connection, so a session connected hours earlier emits nothing in any
 * window. It passed six times only because every prior run happened to
 * include a deploy, which drops live sessions. The event half stays with the
 * agent; a call that returns proves the handshake more directly than an
 * event confirming something already observed.
 */
export const a2Handshake: TestCase = {
  id: "A2",
  title: "an MCP client completes a handshake and a tool answers",
  covers: ["echo"],
  accounts: [],
  run: async (ctx) => {
    const result = await ctx.call("echo", { message: `handshake ${ctx.stamp}` });
    const text = result.content.map((c) => c.text ?? "").join("");
    ctx.evidence(`echo answered ${text.length} characters`);
    if (result.isError) throw new Error(`echo answered with an error: ${text}`);
    if (!text.includes(ctx.stamp)) {
      throw new Error("echo did not return the message it was given, so the round trip is not proven");
    }
  },
};
