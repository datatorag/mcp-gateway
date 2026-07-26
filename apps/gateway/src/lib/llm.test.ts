import { describe, it, expect, vi } from "vitest";

const envState = vi.hoisted(() => ({
  ANTHROPIC_API_KEY: "",
  PLAYGROUND_MODEL: "claude-sonnet-5",
  PLAYGROUND_MESSAGE_CAP: 20,
}));
vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => envState }));

import { getPlaygroundModel } from "./llm";

// Covers getPlaygroundModel — the AI SDK LanguageModel factory that replaced
// getPlaygroundLlm (the legacy @anthropic-ai/sdk client) once the playground
// chat route moved onto streamText. Same null/instance/caching contract, just
// a different return type.
describe("getPlaygroundModel", () => {
  it("returns null (playground disabled) when ANTHROPIC_API_KEY is empty", () => {
    envState.ANTHROPIC_API_KEY = "";
    expect(getPlaygroundModel()).toBeNull();
  });

  it("returns an Anthropic model when key is set", () => {
    envState.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(getPlaygroundModel()).not.toBeNull();
  });

  it("reuses the same model instance for an unchanged key", () => {
    envState.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(getPlaygroundModel()).toBe(getPlaygroundModel());
  });

  it("builds a fresh instance when the key changes", () => {
    envState.ANTHROPIC_API_KEY = "sk-ant-one";
    const first = getPlaygroundModel();
    envState.ANTHROPIC_API_KEY = "sk-ant-two";
    expect(getPlaygroundModel()).not.toBe(first);
  });
});
