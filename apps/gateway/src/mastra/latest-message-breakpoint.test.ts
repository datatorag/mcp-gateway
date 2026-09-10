import { describe, expect, it } from "vitest";
import { latestMessageBreakpoint } from "./latest-message-breakpoint";

/* The processor's choice of tail, on the stored message shape it is handed.
 * The wire-level effect (a cache_control field on the right block) is pinned
 * in prompt-cache.test.ts; this pins which part gets the mark and, above all,
 * which never does: Anthropic rejects cache control on a thinking block, so a
 * reasoning part must never be chosen even when it is the newest part. */

type Part = Record<string, unknown> & { type: string };
const msg = (role: string, parts: Part[]) => ({ role, content: { format: 2, parts } });
const marks = (messages: Array<{ content: { parts: Part[] } }>) =>
  messages.flatMap((m, mi) =>
    m.content.parts.flatMap((p, pi) => {
      const meta = (p.providerMetadata ?? p.callProviderMetadata) as { anthropic?: { cacheControl?: unknown } } | undefined;
      return meta?.anthropic?.cacheControl ? [[mi, pi] as [number, number]] : [];
    })
  );

function run(messages: ReturnType<typeof msg>[]) {
  latestMessageBreakpoint.processInputStep({ messages: messages as unknown[] });
  return marks(messages);
}

describe("latestMessageBreakpoint: which part carries the mark", () => {
  it("marks the last text part of a plain user turn", () => {
    const m = [msg("user", [{ type: "text", text: "hi" }])];
    expect(run(m)).toEqual([[0, 0]]);
  });

  it("skips a trailing step marker and marks the tool invocation before it", () => {
    const m = [
      msg("user", [{ type: "text", text: "hi" }]),
      msg("assistant", [{ type: "tool-invocation", toolInvocation: {} }, { type: "step-start" }]),
    ];
    expect(run(m)).toEqual([[1, 0]]);
  });

  it("never marks a reasoning part, even when it is the newest part", () => {
    const m = [
      msg("user", [{ type: "text", text: "hi" }]),
      msg("assistant", [
        { type: "text", text: "on it" },
        { type: "reasoning", reasoning: "", providerMetadata: { anthropic: { signature: "sig" } } },
        { type: "step-start" },
      ]),
    ];
    expect(run(m)).toEqual([[1, 0]]);
    // The signature the provider needs back is left exactly as it was.
    expect(m[1]!.content.parts[1]!.providerMetadata).toEqual({ anthropic: { signature: "sig" } });
  });

  it("marks nothing when only reasoning and markers exist, rather than a thinking block", () => {
    const m = [msg("assistant", [{ type: "reasoning", reasoning: "" }, { type: "step-start" }])];
    expect(run(m)).toEqual([]);
  });

  it("moves the mark: an earlier mark is cleared, other metadata kept", () => {
    const m = [
      msg("user", [{ type: "text", text: "hi", providerMetadata: { anthropic: { cacheControl: { type: "ephemeral" } }, other: 1 } }]),
      msg("assistant", [{ type: "tool-invocation", toolInvocation: {} }]),
    ];
    expect(run(m)).toEqual([[1, 0]]);
    expect(m[0]!.content.parts[0]!.providerMetadata).toEqual({ other: 1 });
  });
});
