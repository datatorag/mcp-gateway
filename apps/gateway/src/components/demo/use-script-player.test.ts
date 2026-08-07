import { describe, expect, it } from "vitest";
import { DEMO_SCRIPTS } from "./demo-scripts";
import {
  advance,
  buildMessages,
  decide,
  finishedState,
  initialState,
  type PlayerState,
} from "./use-script-player";

const script = DEMO_SCRIPTS[0]; // sheets

/** Run the clock until it stops asking for transitions (terminal or
 * awaiting a decision). Bounded so a transition loop fails the test rather
 * than hanging it. */
function runUntilHold(state: PlayerState): PlayerState {
  for (let i = 0; i < 1000; i++) {
    const pending = advance(script, state);
    if (!pending) return state;
    state = pending.next;
  }
  throw new Error("player did not settle in 1000 transitions");
}

describe("script player state machine", () => {
  it("plays to the approval gate and holds there", () => {
    const held = runUntilHold(initialState());
    expect(held.phase).toBe("awaiting-approval");
    const messages = buildMessages(script, held);
    const parts = messages.flatMap((m) => m.parts);
    const pending = parts.find(
      (p) => "state" in p && p.state === "approval-requested"
    );
    expect(pending).toBeDefined();
  });

  it("approve resolves the write and plays to done", () => {
    const held = runUntilHold(initialState());
    const done = runUntilHold(decide(held, true));
    expect(done.phase).toBe("done");
    const parts = buildMessages(script, done).flatMap((m) => m.parts);
    const resolved = parts.find(
      (p) => "state" in p && p.state === "output-available" && String(p.type).includes("sheets_update")
    );
    expect(resolved).toBeDefined();
    // The closing assistant summary rendered in full.
    const lastText = parts.filter((p) => p.type === "text").at(-1);
    expect(lastText && "text" in lastText ? lastText.text : "").toContain(
      "Rows 4 and 5"
    );
  });

  it("deny shows the denied state and the scripted acknowledgment", () => {
    const held = runUntilHold(initialState());
    const done = runUntilHold(decide(held, false));
    expect(done.phase).toBe("done");
    const parts = buildMessages(script, done).flatMap((m) => m.parts);
    expect(
      parts.some((p) => "state" in p && p.state === "output-denied")
    ).toBe(true);
    const texts = parts.filter((p) => p.type === "text");
    expect(texts.at(-1) && "text" in texts.at(-1)!
      ? (texts.at(-1) as { text: string }).text
      : ""
    ).toBe(script.deniedText);
  });

  it("decide is a no-op unless an approval is pending", () => {
    const fresh = initialState();
    expect(decide(fresh, true)).toBe(fresh);
  });

  it("reduced-motion end state is complete, approved, and terminal", () => {
    for (const s of DEMO_SCRIPTS) {
      const end = finishedState(s);
      expect(end.phase).toBe("done");
      expect(advance(s, end)).toBeNull();
      const parts = buildMessages(s, end).flatMap((m) => m.parts);
      // Every beat rendered; the approval shows as resolved, not pending.
      expect(
        parts.some((p) => "state" in p && p.state === "approval-requested")
      ).toBe(false);
      expect(
        parts.some((p) => "state" in p && p.state === "output-available")
      ).toBe(true);
    }
  });

  it("word-streams assistant text rather than dumping it", () => {
    // Advance a few transitions past the first user message and confirm a
    // partial (non-empty, incomplete) assistant text renders mid-stream.
    let state = initialState();
    const firstAssistant = script.steps.findIndex(
      (s) => s.kind === "assistant"
    );
    while (state.cursor < firstAssistant) {
      state = advance(script, state)!.next;
    }
    state = advance(script, state)!.next; // first word
    state = advance(script, state)!.next; // second word
    const parts = buildMessages(script, state).flatMap((m) => m.parts);
    const text = parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .at(-1)!.text;
    const full = (script.steps[firstAssistant] as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(full.length);
    expect(full.startsWith(text)).toBe(true);
  });
});
