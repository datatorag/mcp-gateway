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
import { replayMessage, replayPart, replayThread, withRunStatus } from "./replay";

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
    // SCRUM-262: reasoning replays as the row the live thread shows, so a
    // reload mid-run renders the same rows; an empty one is nothing.
    expect(replayPart({ type: "reasoning", text: "thinking" })).toEqual({ type: "reasoning", text: "thinking", state: "done" });
    expect(replayPart({ type: "reasoning", text: "" })).toBeNull();
    expect(replayPart({ type: "reasoning" })).toBeNull();
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

  it("replays the inline connect offer (SCRUM-78)", () => {
    // The connect flow is a full-page OAuth round trip, so the one moment
    // this part matters most is when the thread is rehydrated on return. If
    // it dropped out of the allow-list, the user would come back to a
    // conversation whose connect control had silently vanished.
    const connect = {
      type: "data-connect",
      data: {
        services: [
          {
            id: "google-workspace",
            name: "Google Workspace",
            connectHref: "/auth/google/connect",
          },
        ],
      },
    };
    expect(replayPart(connect as never)).toEqual(connect);
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

/* SCRUM-254: a thread whose run outlived its viewer says so on reload. The
 * registry is the route's record; this is the pure step that turns it into
 * the card the user sees, reusing the SCRUM-234 stop card. */
describe("the run's state after the viewer left (SCRUM-254)", () => {
  const stored = [
    { id: "u1", role: "user", content: { parts: [{ type: "text", text: "run it" }] } },
    { id: "a1", role: "assistant", content: { parts: [{ type: "text", text: "Reading mail." }] } },
  ];
  const base = { runId: "r1", skill: "morning-brief", cap: 60, startedAt: 0, updatedAt: 0 };

  it("says nothing when nothing is known, and nothing for a completed run", () => {
    expect(withRunStatus(replayThread(stored), undefined)).toHaveLength(2);
    expect(withRunStatus(replayThread(stored), { ...base, steps: 7, state: "completed" })).toHaveLength(2);
  });

  it("appends the running card, with no limit and the steps so far, for a run in flight", () => {
    const out = withRunStatus(replayThread(stored), { ...base, steps: 4, state: "running" });
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({
      role: "assistant",
      parts: [{ type: "data-run-stopped", data: { limit: "running", steps: 4, cap: 60, skill: "morning-brief" } }],
    });
  });

  it("appends the limit card for a run that stopped after the viewer left", () => {
    const out = withRunStatus(replayThread(stored), { ...base, steps: 6, state: "stopped", limit: "size" });
    expect(out[2]).toMatchObject({
      parts: [{ type: "data-run-stopped", data: { limit: "size", steps: 6, cap: null, skill: "morning-brief" } }],
    });
    const steps = withRunStatus(replayThread(stored), { ...base, steps: 60, state: "stopped", limit: "steps" });
    expect(steps[2]).toMatchObject({
      parts: [{ type: "data-run-stopped", data: { limit: "steps", steps: 60, cap: 60 } }],
    });
  });

  it("appends the error card for a run that failed after the viewer left", () => {
    const out = withRunStatus(replayThread(stored), { ...base, steps: 2, state: "failed" });
    expect(out[2]).toMatchObject({
      parts: [{ type: "data-run-stopped", data: { limit: "error", steps: 2, cap: null, skill: "morning-brief" } }],
    });
  });

  it("does not double a card the stored thread already carries", () => {
    const withCard = [
      ...stored,
      {
        id: "a2",
        role: "assistant",
        content: { parts: [{ type: "data-run-stopped", data: { limit: "size", steps: 6, cap: null, skill: null } }] },
      },
    ];
    const out = withRunStatus(replayThread(withCard), { ...base, steps: 6, state: "stopped", limit: "size" });
    const cards = out.flatMap((m) => m.parts).filter((p) => (p as { type?: string }).type === "data-run-stopped");
    expect(cards).toHaveLength(1);
  });

  it("the stored stop card replays, so a card the runtime kept survives a reload", () => {
    const part = { type: "data-run-stopped", data: { limit: "steps", steps: 60, cap: 60, skill: "morning-brief" } };
    expect(replayPart(part)).toEqual(part);
  });
});

/* SCRUM-257: the run summary line is a data part the runtime keeps, so a
 * reload shows what the run cost as the user saw it. */
describe("the run summary line replays (SCRUM-257)", () => {
  it("passes the stored summary part through", () => {
    const part = { type: "data-run-summary", data: { steps: 7, weightedTokens: 184_099, costUsd: 0.99, model: "claude-sonnet-5" } };
    expect(replayPart(part)).toEqual(part);
  });
});

/* SCRUM-258: a run the user stopped shows the stopped card on reload. */
describe("the user's stop on reload (SCRUM-258)", () => {
  it("appends the user card for a run stopped by the user after the viewer left", () => {
    const stored = [
      { id: "u1", role: "user", content: { parts: [{ type: "text", text: "run it" }] } },
    ];
    const out = withRunStatus(replayThread(stored), { runId: "r1", skill: "morning-brief", cap: 60, steps: 3, state: "stopped", limit: "user" });
    expect(out[1]).toMatchObject({
      parts: [{ type: "data-run-stopped", data: { limit: "user", steps: 3, cap: null, skill: "morning-brief" } }],
    });
  });
});
