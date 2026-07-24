import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ModelMessage } from "ai";
import { putPending, takePending, _resetPendingStore } from "./pending";
import type { PendingWrite } from "./engine";

const writes: PendingWrite[] = [
  { id: "w_1", name: "gws-mcp__gmail_send", input: { to: "a@b.com" } },
];
const messages: ModelMessage[] = [{ role: "assistant", content: [] }];

describe("playground pending store", () => {
  beforeEach(() => _resetPendingStore());

  it("round-trips a paused turn for the owning user", () => {
    const token = putPending("user-1", messages, writes);
    const got = takePending("user-1", token);
    expect(got).not.toBeNull();
    expect(got!.writes).toEqual(writes);
    expect(got!.messages).toEqual(messages);
  });

  it("is one-shot: a token can't be taken twice", () => {
    const token = putPending("user-1", messages, writes);
    expect(takePending("user-1", token)).not.toBeNull();
    expect(takePending("user-1", token)).toBeNull();
  });

  it("refuses a token that belongs to a different user", () => {
    const token = putPending("user-1", messages, writes);
    expect(takePending("user-2", token)).toBeNull();
    // and the (foreign) take consumed it — it's gone for everyone now
    expect(takePending("user-1", token)).toBeNull();
  });

  it("returns null for an unknown token", () => {
    expect(takePending("user-1", "nope")).toBeNull();
  });
});

// Mirrors the constants in pending.ts (neither is exported). If either
// changes there, these tests fail loudly rather than silently drifting.
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

describe("playground pending store: expiry and eviction", () => {
  beforeEach(() => {
    _resetPendingStore();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The TTL is the ONLY thing that stops a leaked/stolen resume token from
  // being redeemed later to execute a real write against the user's Google
  // Workspace / Atlassian account, so both sides of the boundary are pinned.
  it("accepts a token taken just before the 5-minute TTL", () => {
    const token = putPending("user-1", messages, writes);
    vi.advanceTimersByTime(TTL_MS - 1);
    expect(takePending("user-1", token)).not.toBeNull();
  });

  it("refuses a token taken after the 5-minute TTL", () => {
    const token = putPending("user-1", messages, writes);
    vi.advanceTimersByTime(TTL_MS + 1);
    expect(takePending("user-1", token)).toBeNull();
  });

  it("evicts oldest-first once MAX_ENTRIES is exceeded", () => {
    // `sweep` runs at the TOP of putPending, so the cap is enforced against
    // the size BEFORE the new insert: MAX_ENTRIES + 2 puts is the first point
    // at which an eviction has actually happened.
    const tokens: string[] = [];
    for (let i = 0; i < MAX_ENTRIES + 2; i++) {
      tokens.push(putPending("user-1", messages, writes));
    }
    // Oldest gone...
    expect(takePending("user-1", tokens[0])).toBeNull();
    // ...newest (and the one just after the evicted head) still there.
    expect(takePending("user-1", tokens[1])).not.toBeNull();
    expect(takePending("user-1", tokens[tokens.length - 1])).not.toBeNull();
  });
});
