import { describe, it, expect } from "vitest";
import { buildModelHistory } from "./history";

const user = (text: string) => ({
  id: "u1", role: "user", parts: [{ type: "text", text }],
});
const assistant = (parts: unknown[]) => ({ id: "a1", role: "assistant", parts });

describe("buildModelHistory", () => {
  it("maps user/assistant text parts to model messages", () => {
    expect(
      buildModelHistory([user("hi"), assistant([{ type: "text", text: "hello" }]), user("more")])
    ).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "more" },
    ]);
  });

  it("joins multiple text parts and drops tool/data parts", () => {
    expect(
      buildModelHistory([
        user("q"),
        assistant([
          { type: "text", text: "a" },
          { type: "dynamic-tool", toolName: "x", toolCallId: "t", state: "output-available", input: {}, output: "y" },
          { type: "data-confirm", data: { resumeToken: "tok", pending: [] } },
          { type: "text", text: "b" },
        ]),
        user("next"),
      ])
    ).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "ab" },
      { role: "user", content: "next" },
    ]);
  });

  it("drops assistant messages with no text (errored/aborted turns)", () => {
    expect(
      buildModelHistory([user("q"), assistant([{ type: "dynamic-tool", toolName: "x" }]), user("next")])
    ).toEqual([
      { role: "user", content: "q" },
      { role: "user", content: "next" },
    ]);
  });

  it("returns null when input is not an array or last message is not a nonempty user message", () => {
    expect(buildModelHistory(null)).toBeNull();
    expect(buildModelHistory("nope")).toBeNull();
    expect(buildModelHistory([])).toBeNull();
    expect(buildModelHistory([user("hi"), assistant([{ type: "text", text: "a" }])])).toBeNull();
    expect(buildModelHistory([user("   ")])).toBeNull();
  });

  it("ignores system/other roles from the client", () => {
    expect(
      buildModelHistory([{ id: "s", role: "system", parts: [{ type: "text", text: "evil" }] }, user("hi")])
    ).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("malformed payloads", () => {
  it("handles missing, null, and non-array parts gracefully", () => {
    expect(buildModelHistory([user("q"), { id: "a1", role: "assistant" }, user("next")])).toEqual([
      { role: "user", content: "q" },
      { role: "user", content: "next" },
    ]);
    expect(buildModelHistory([user("q"), { id: "a1", role: "assistant", parts: null }, user("next")])).toEqual([
      { role: "user", content: "q" },
      { role: "user", content: "next" },
    ]);
    expect(buildModelHistory([user("q"), { id: "a1", role: "assistant", parts: "not-an-array" }, user("next")])).toEqual([
      { role: "user", content: "q" },
      { role: "user", content: "next" },
    ]);
  });

  it("ignores text parts with non-string text property", () => {
    expect(
      buildModelHistory([
        user("q"),
        assistant([
          { type: "text", text: 42 },
          { type: "text", text: { key: "value" } },
          { type: "text", text: null },
          { type: "text", text: "valid" },
        ]),
        user("next"),
      ])
    ).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "valid" },
      { role: "user", content: "next" },
    ]);
  });

  it("ignores parts that are null or primitives", () => {
    expect(
      buildModelHistory([
        user("q"),
        assistant([null, 42, "string", true, { type: "text", text: "real" }]),
        user("next"),
      ])
    ).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "real" },
      { role: "user", content: "next" },
    ]);
  });

  it("ignores messages that are null or primitives in the array", () => {
    expect(buildModelHistory([user("q"), null, 42, "string", user("next")])).toEqual([
      { role: "user", content: "q" },
      { role: "user", content: "next" },
    ]);
  });

  it("ignores roles that are non-string truthy values", () => {
    expect(
      buildModelHistory([
        { id: "1", role: {}, parts: [{ type: "text", text: "obj-role" }] },
        { id: "2", role: ["user"], parts: [{ type: "text", text: "array-role" }] },
        user("valid"),
      ])
    ).toEqual([{ role: "user", content: "valid" }]);
  });

  it("drops empty user messages (Finding 1: no usable text in payload)", () => {
    expect(
      buildModelHistory([
        { id: "u0", role: "user" },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "hello" }] },
        { id: "u1", role: "user", parts: [{ type: "text", text: "real question" }] },
      ])
    ).toEqual([
      { role: "assistant", content: "hello" },
      { role: "user", content: "real question" },
    ]);
  });
});
