import { describe, it, expect, vi } from "vitest";

const envState = vi.hoisted(() => ({
  ANTHROPIC_API_KEY: "",
  PLAYGROUND_PROVIDER: "anthropic",
  PLAYGROUND_MODEL: "claude-sonnet-5",
  PLAYGROUND_MESSAGE_CAP: 20,
}));
vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => envState }));

import { getPlaygroundLlm } from "./llm";

describe("getPlaygroundLlm", () => {
  it("returns null (playground disabled) when ANTHROPIC_API_KEY is empty and provider is anthropic", () => {
    envState.ANTHROPIC_API_KEY = "";
    envState.PLAYGROUND_PROVIDER = "anthropic";
    expect(getPlaygroundLlm()).toBeNull();
  });

  it("returns an Anthropic client when key is set", () => {
    envState.ANTHROPIC_API_KEY = "sk-ant-test";
    envState.PLAYGROUND_PROVIDER = "anthropic";
    expect(getPlaygroundLlm()).not.toBeNull();
  });

  it("returns a Bedrock client when provider is bedrock, regardless of API key", () => {
    envState.ANTHROPIC_API_KEY = "";
    envState.PLAYGROUND_PROVIDER = "bedrock";
    expect(getPlaygroundLlm()).not.toBeNull();
  });

  it("reuses the same client instance for an unchanged provider/key config", () => {
    envState.ANTHROPIC_API_KEY = "sk-ant-test";
    envState.PLAYGROUND_PROVIDER = "anthropic";
    expect(getPlaygroundLlm()).toBe(getPlaygroundLlm());
  });
});
