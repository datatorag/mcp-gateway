import { describe, expect, it } from "vitest";
import { finishedFrame, partialResultMarkdown, replayTimeline, resultPieces } from "./replay-timeline";

const USE_CASE = {
  prompt: "Find the thread and file it.",
  steps: [
    { tool: "gws-mcp__gmail_search", label: "Find the thread" },
    { tool: "atlassian-mcp__jira_create_issue", label: "Create the issue" },
  ],
  result: { kind: "created" as const, what: "Jira issue", title: "ABC-1: A bug", lines: ["Type: Bug.", "A link."] },
};

describe("the replay's frames", () => {
  const frames = replayTimeline(USE_CASE);

  it("go in the order of a real turn: the prompt is typed, each step runs then finishes, the answer arrives, the result draws in", () => {
    // Nothing ever goes backwards.
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].typed).toBeGreaterThanOrEqual(frames[i - 1].typed);
      expect(frames[i].steps).toBeGreaterThanOrEqual(frames[i - 1].steps);
      expect(frames[i].pieces).toBeGreaterThanOrEqual(frames[i - 1].pieces);
    }
    // No step shows before the prompt is whole, and no answer before every step is done.
    for (const f of frames) {
      if (f.steps > 0) expect(f.typed).toBe(USE_CASE.prompt.length);
      if (f.answered) expect([f.steps, f.running]).toEqual([USE_CASE.steps.length, false]);
      if (f.pieces > 0) expect(f.answered).toBe(true);
    }
    expect(frames[0]).toMatchObject({ typed: 0, steps: 0, answered: false, pieces: 0 });
  });

  it("show each step running once and then finished", () => {
    for (let step = 1; step <= USE_CASE.steps.length; step++) {
      const of = frames.filter((f) => f.steps === step && !f.answered);
      expect(of.map((f) => f.running)).toEqual([true, false]);
    }
  });

  it("end on the finished conversation, and every frame has a time to stay", () => {
    const { holdMs: _last, ...end } = frames.at(-1)!;
    const { holdMs: _zero, ...finished } = finishedFrame(USE_CASE);
    expect(end).toEqual(finished);
    expect(frames.every((f) => f.holdMs > 0)).toBe(true);
  });

  it("type a long prompt in a bounded number of frames", () => {
    const long = replayTimeline({ ...USE_CASE, prompt: "word ".repeat(400) });
    expect(long.filter((f) => f.steps === 0 && !f.answered).length).toBeLessThanOrEqual(62);
  });
});

describe("a result drawn a piece at a time", () => {
  it("text: a line per piece", () => {
    const result = { kind: "text" as const, lines: ["a", "b", "c"] };
    expect(resultPieces(result)).toBe(3);
    expect(partialResultMarkdown(result, 0)).toBe("");
    expect(partialResultMarkdown(result, 2)).toBe("- a\n- b");
  });

  it("a table: its header from the first row on, then a row per piece", () => {
    const result = { kind: "table" as const, columns: ["A", "B"], rows: [["1", "2"], ["3", "4"]] };
    expect(resultPieces(result)).toBe(2);
    expect(partialResultMarkdown(result, 1)).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(partialResultMarkdown(result, 2)).toContain("| 3 | 4 |");
  });

  it("a created thing: its title first, then its lines", () => {
    expect(resultPieces(USE_CASE.result)).toBe(3);
    expect(partialResultMarkdown(USE_CASE.result, 1)).toBe("**Jira issue: ABC-1: A bug**");
    expect(partialResultMarkdown(USE_CASE.result, 3)).toBe("**Jira issue: ABC-1: A bug**\n\n- Type: Bug.\n- A link.");
  });
});
