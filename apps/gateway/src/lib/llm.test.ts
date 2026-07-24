import { describe, it, expect, vi } from "vitest";

const envState = vi.hoisted(() => ({
  ANTHROPIC_API_KEY: "",
  PLAYGROUND_PROVIDER: "anthropic",
  PLAYGROUND_MODEL: "claude-sonnet-5",
  PLAYGROUND_MESSAGE_CAP: 20,
}));
vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => envState }));

import { getPlaygroundModel } from "./llm";

// Covers getPlaygroundModel — the AI SDK LanguageModel factory that replaced
// getPlaygroundLlm (the legacy @anthropic-ai/sdk / @anthropic-ai/bedrock-sdk
// client) once the playground chat route moved onto streamText. Same
// null/instance/caching contract, just a different return type.
describe("getPlaygroundModel", () => {
  it("returns null (playground disabled) when ANTHROPIC_API_KEY is empty and provider is anthropic", () => {
    envState.ANTHROPIC_API_KEY = "";
    envState.PLAYGROUND_PROVIDER = "anthropic";
    expect(getPlaygroundModel()).toBeNull();
  });

  it("returns an Anthropic model when key is set", () => {
    envState.ANTHROPIC_API_KEY = "sk-ant-test";
    envState.PLAYGROUND_PROVIDER = "anthropic";
    expect(getPlaygroundModel()).not.toBeNull();
  });

  it("returns a Bedrock model when provider is bedrock, regardless of API key", () => {
    envState.ANTHROPIC_API_KEY = "";
    envState.PLAYGROUND_PROVIDER = "bedrock";
    expect(getPlaygroundModel()).not.toBeNull();
  });

  it("reuses the same model instance for an unchanged provider/key config", () => {
    envState.ANTHROPIC_API_KEY = "sk-ant-test";
    envState.PLAYGROUND_PROVIDER = "anthropic";
    expect(getPlaygroundModel()).toBe(getPlaygroundModel());
  });
});
