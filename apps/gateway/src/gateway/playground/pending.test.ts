import { describe, it, expect, beforeEach } from "vitest";
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
