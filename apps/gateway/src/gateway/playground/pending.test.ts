import { describe, it, expect, beforeEach } from "vitest";
import { putPending, takePending, _resetPendingStore } from "./pending";
import type { ToolUse } from "./engine";

const batch: ToolUse[] = [{ id: "w_1", name: "gws-mcp__gmail_send", input: { to: "a@b.com" } }];
const messages = [{ role: "assistant", content: [] }];

describe("playground pending store", () => {
  beforeEach(() => _resetPendingStore());

  it("round-trips a paused turn for the owning user", () => {
    const token = putPending("user-1", messages, batch);
    const got = takePending("user-1", token);
    expect(got).not.toBeNull();
    expect(got!.batch).toEqual(batch);
    expect(got!.messages).toEqual(messages);
  });

  it("is one-shot: a token can't be taken twice", () => {
    const token = putPending("user-1", messages, batch);
    expect(takePending("user-1", token)).not.toBeNull();
    expect(takePending("user-1", token)).toBeNull();
  });

  it("refuses a token that belongs to a different user", () => {
    const token = putPending("user-1", messages, batch);
    expect(takePending("user-2", token)).toBeNull();
    // and the (foreign) take consumed it — it's gone for everyone now
    expect(takePending("user-1", token)).toBeNull();
  });

  it("returns null for an unknown token", () => {
    expect(takePending("user-1", "nope")).toBeNull();
  });
});
