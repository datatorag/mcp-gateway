/**
 * Does a stored conversation come back looking like the one the user had?
 *
 * Two failures this pins, both found by reading real stored rows rather than
 * by imagining what storage holds:
 *
 * 1. Stored tool activity uses the older `tool-invocation` shape. It does not
 *    fall through the renderer harmlessly — `isToolPart` matches anything
 *    starting with `tool-`, so an unconverted part renders as a card titled
 *    with the literal word "invocation", carrying no arguments and no result.
 *
 * 2. A turn that stopped for a write approval cannot be resumed. The run is
 *    consumed and the approval id does not survive a restart, so replaying the
 *    buttons produces two controls that answer 403. This surface has already
 *    been rolled back twice over controls that do nothing.
 */

import { describe, expect, it } from "vitest";
import { replayMessage, replayPart, replayThread } from "./replay";

const toolPart = (over: Record<string, unknown> = {}) => ({
  type: "tool-invocation",
  toolInvocation: {
    toolName: "gws-mcp__drive_search",
    args: { query: "q3" },
    result: { files: 2 },
    state: "result",
    toolCallId: "call-1",
    ...over,
  },
});

describe("stored tool activity becomes something the renderer understands", () => {
  it("uses the live tool- prefix with the REAL name, not the word invocation", () => {
    const out = replayPart(toolPart()) as { type: string };
    expect(out.type).toBe("tool-gws-mcp__drive_search");
    // The exact defect: the renderer slices "tool-" off "tool-invocation".
    expect(out.type).not.toBe("tool-invocation");
    expect(out.type.slice("tool-".length)).not.toBe("invocation");
  });

  it("lifts arguments and result out of the nested shape", () => {
    const out = replayPart(toolPart()) as { input: unknown; output: unknown; state: string };
    expect(out.input).toEqual({ query: "q3" });
    expect(out.output).toEqual({ files: 2 });
    expect(out.state).toBe("output-available");
  });

  it("does not invent a result for a call that never produced one", () => {
    const out = replayPart(
      toolPart({ result: undefined, state: "call" })
    ) as { state: string; output?: unknown };
    expect(out.output).toBeUndefined();
    expect(out.state).toBe("output-error");
  });
});

describe("a decision that can no longer be given", () => {
  it("comes back inert, never as a tool call awaiting approval", () => {
    const out = replayPart(
      toolPart({ state: "approval-requested", result: undefined })
    ) as { type: string; data: { toolName: string } };
    expect(out.type).toBe("data-approval-expired");
    expect(out.data.toolName).toBe("gws-mcp__drive_search");
    // Nothing that could render an Approve/Deny pair.
    expect(out.type.startsWith("tool-")).toBe(false);
  });

  it("handles the stored approval data part too", () => {
    const out = replayPart({
      type: "data-tool-call-approval",
      data: { toolName: "atlassian-mcp__jira_create_issue" },
    } as never) as { type: string; data: { toolName: string } };
    expect(out.type).toBe("data-approval-expired");
    expect(out.data.toolName).toBe("atlassian-mcp__jira_create_issue");
  });

  it("leaves the write un-run, which is the truth", () => {
    // An expired approval must not be dressed up as a completed call: nothing
    // was approved, so nothing ran.
    const out = replayPart(toolPart({ state: "approval-requested", result: undefined })) as {
      state?: string;
      output?: unknown;
    };
    expect(out.state).toBeUndefined();
    expect(out.output).toBeUndefined();
  });
});

describe("the parts that should vanish", () => {
  it("drops stream bookkeeping", () => {
    expect(replayPart({ type: "step-start" })).toBeNull();
    expect(replayPart({ type: "reasoning", text: "thinking" })).toBeNull();
  });

  it("keeps text", () => {
    expect(replayPart({ type: "text", text: "hello" })).toEqual({ type: "text", text: "hello" });
    expect(replayPart({ type: "text", text: "" })).toBeNull();
  });

  it("replays only allow-listed data parts, and drops anything else", () => {
    // `data-*` is an open namespace and this converter is the boundary between
    // stored bytes and rendered UI. An unknown kind renders as nothing either
    // way, so refusing it here costs nothing and removes the question of what
    // a hostile stored part could do the day threads are shared or exported.
    const known = { type: "data-account-state", data: { runsRemaining: 1 } };
    expect(replayPart(known as never)).toEqual(known);
    expect(replayPart({ type: "data-something-new", data: { a: 1 } } as never)).toBeNull();
  });
});

describe("whole messages", () => {
  it("skips a message whose parts were all bookkeeping rather than rendering it empty", () => {
    expect(
      replayMessage({ id: "m", role: "assistant", content: { parts: [{ type: "step-start" }] } })
    ).toBeNull();
  });

  it("falls back to the flat content field rather than losing the message", () => {
    const out = replayMessage({
      id: "m",
      role: "user",
      content: { parts: [{ type: "step-start" }], content: "what is in my drive" },
    });
    expect(out?.parts).toEqual([{ type: "text", text: "what is in my drive" }]);
  });

  it("handles an older row that stored a bare string", () => {
    const out = replayMessage({ id: "m", role: "user", content: "hi" });
    expect(out?.parts).toEqual([{ type: "text", text: "hi" }]);
  });

  it("keeps roles, and treats anything unexpected as assistant", () => {
    expect(replayMessage({ id: "a", role: "user", content: "x" })?.role).toBe("user");
    expect(replayMessage({ id: "b", role: "system", content: "x" })?.role).toBe("assistant");
  });

  it("replays a thread in order, dropping only the empties", () => {
    const out = replayThread([
      { id: "1", role: "user", content: { parts: [{ type: "text", text: "find it" }] } },
      { id: "2", role: "assistant", content: { parts: [{ type: "step-start" }] } },
      { id: "3", role: "assistant", content: { parts: [toolPart(), { type: "text", text: "done" }] } },
    ]);
    expect(out.map((m) => m.id)).toEqual(["1", "3"]);
    expect((out[1].parts[0] as { type: string }).type).toBe("tool-gws-mcp__drive_search");
  });
});
