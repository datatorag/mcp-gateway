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
