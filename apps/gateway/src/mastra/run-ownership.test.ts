import { describe, it, expect } from "vitest";
import { deriveThreadId, findApprovalTargets, mintRunId, ownsRunId } from "./run-ownership";

/** The primitives the approval gate is built out of.
 *
 * The gate is proved end to end, against a real MCP server, in
 * `../app/api/playground/chat/route.ownership.test.ts` — that file answers
 * "can B execute A's write". This one pins the properties that make the answer
 * hold: that a run id names exactly one owner, that a hostile request body
 * cannot smuggle an approval past the scan, and that a thread id cannot cross
 * accounts. */

describe("run ids", () => {
  it("verifies for the user it was minted for, and nobody else", () => {
    const runId = mintRunId("user-a");

    expect(ownsRunId("user-a", runId)).toBe(true);
    expect(ownsRunId("user-b", runId)).toBe(false);
    // Not a prefix or substring match: near-misses on the id are still misses.
    expect(ownsRunId("user-a ", runId)).toBe(false);
    expect(ownsRunId("", runId)).toBe(false);
  });

  it("is unguessable rather than merely unique", () => {
    const first = mintRunId("user-a");
    const second = mintRunId("user-a");

    expect(first).not.toBe(second);
    // Two ids for the SAME user share no tag, so seeing one teaches nothing
    // about the next.
    expect(first.split("~")[1]).not.toBe(second.split("~")[1]);
  });

  it("cannot be forged by pasting a user id into a well-formed shape", () => {
    // The obvious attack if ownership were encoded rather than authenticated.
    expect(ownsRunId("user-a", "nonce~user-a")).toBe(false);
    expect(ownsRunId("user-a", `nonce~${Buffer.from("user-a").toString("base64url")}`)).toBe(false);
  });

  it("rejects malformed ids instead of throwing", () => {
    // These arrive from a request body, so the failure mode has to be `false`,
    // not an exception that some caller might interpret as a pass.
    for (const candidate of ["", "~", "no-separator", "~tag-only", "nonce~"]) {
      expect(ownsRunId("user-a", candidate)).toBe(false);
    }
  });

  it("never contains the separator the runtime splits approval ids on", () => {
    // A run id containing `::` would be torn apart at the wrong place when the
    // runtime recovers it, and would never verify.
    for (let i = 0; i < 200; i += 1) {
      expect(mintRunId(`user-${i}`)).not.toContain("::");
    }
  });
});

describe("finding approval responses in a request body", () => {
  const target = (approvalId: string, approved = true) => ({
    role: "assistant",
    parts: [{ state: "approval-responded", toolCallId: "c1", approval: { id: approvalId, approved } }],
  });

  it("finds a decision anywhere in the history, not only on the last message", () => {
    const found = findApprovalTargets([
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      target("run-one::c1"),
      { role: "user", parts: [{ type: "text", text: "again" }] },
      target("run-two::c2", false),
    ]);

    // Deliberately broader than what the runtime acts on: anything it could
    // resume has already been seen here, whatever its extractor does next.
    expect(found).toEqual([
      { runId: "run-one", approved: true },
      { runId: "run-two", approved: false },
    ]);
  });

  it("splits a run id containing colons at the LAST separator", () => {
    expect(findApprovalTargets([target("a::b::c1")])).toEqual([
      { runId: "a::b", approved: true },
    ]);
  });

  it("ignores parts that are not a settled decision", () => {
    const found = findApprovalTargets([
      { role: "assistant", parts: [{ state: "input-available", approval: { id: "r::c" } }] },
      { role: "assistant", parts: [{ state: "approval-responded" }] },
      { role: "assistant", parts: [{ state: "approval-responded", approval: { id: 42 } }] },
      // Empty run id — never something we minted.
      { role: "assistant", parts: [{ state: "approval-responded", approval: { id: "::c" } }] },
      // A user message cannot carry a decision, whatever it claims.
      { role: "user", parts: [{ state: "approval-responded", approval: { id: "r::c" } }] },
    ]);

    expect(found).toEqual([]);
  });

  it("survives a body that is hostile rather than merely wrong", () => {
    // Straight off the wire, so every level is untrusted until proven.
    for (const body of [null, undefined, "string", 7, {}, [null], [{ parts: null }], [[]]]) {
      expect(findApprovalTargets(body)).toEqual([]);
    }
  });

  it("treats anything other than an explicit true as a denial", () => {
    expect(findApprovalTargets([target("r::c1", "yes" as never)])).toEqual([
      { runId: "r", approved: false },
    ]);
  });
});

describe("thread ids", () => {
  it("sends the same conversation id to different threads for different users", () => {
    // The whole point: a client picks the conversation id, so it must not be
    // able to name someone else's conversation.
    expect(deriveThreadId("user-a", "chat-1")).not.toBe(deriveThreadId("user-b", "chat-1"));
  });

  it("is stable, so a returning user finds the same conversation", () => {
    expect(deriveThreadId("user-a", "chat-1")).toBe(deriveThreadId("user-a", "chat-1"));
    expect(deriveThreadId("user-a", "chat-1")).not.toBe(deriveThreadId("user-a", "chat-2"));
  });

  it("produces a usable id even when the client sends none", () => {
    expect(deriveThreadId("user-a", "")).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
