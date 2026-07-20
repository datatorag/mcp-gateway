import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { getEnv } from "@datatorag-mcp/config";

/** Minimal surface the playground engine needs from either SDK client. */
export type PlaygroundLlm = { messages: { create: Anthropic["messages"]["create"] } };

export function isPlaygroundEnabled(): boolean {
  const env = getEnv();
  return env.PLAYGROUND_PROVIDER === "bedrock" || env.ANTHROPIC_API_KEY !== "";
}

export function getPlaygroundLlm(): PlaygroundLlm | null {
  const env = getEnv();
  if (env.PLAYGROUND_PROVIDER === "bedrock") {
    // Messages-API Bedrock client (AnthropicBedrock is the legacy InvokeModel
    // path). Credentials from the instance's AWS environment (IAM); region
    // required — read AWS_REGION with a us-west-2 fallback.
    return new AnthropicBedrockMantle({
      awsRegion: process.env.AWS_REGION ?? "us-west-2",
    }) as unknown as PlaygroundLlm;
  }
  if (!env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}
