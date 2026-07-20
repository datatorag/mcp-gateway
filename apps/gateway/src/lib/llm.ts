import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { getEnv } from "@datatorag-mcp/config";

/** Minimal surface the playground engine needs from either SDK client. */
export type PlaygroundLlm = { messages: { create: Anthropic["messages"]["create"] } };

// Both SDK clients are stateless and safe to share across requests; the
// Bedrock client in particular caches its resolved AWS credential chain, so
// rebuilding it per request would re-resolve credentials every time. Keyed
// by provider+key so a config change (tests, env reload) gets a fresh client.
let cached: { key: string; llm: PlaygroundLlm } | null = null;

/** The playground's LLM client, or null when the playground is disabled
 * (provider "anthropic" with no ANTHROPIC_API_KEY set). */
export function getPlaygroundLlm(): PlaygroundLlm | null {
  const env = getEnv();
  const key = `${env.PLAYGROUND_PROVIDER}:${env.ANTHROPIC_API_KEY}`;
  if (cached?.key === key) return cached.llm;

  let llm: PlaygroundLlm;
  if (env.PLAYGROUND_PROVIDER === "bedrock") {
    // Messages-API Bedrock client (AnthropicBedrock is the legacy InvokeModel
    // path). Credentials from the instance's AWS environment (IAM); region
    // required — read AWS_REGION with a us-west-2 fallback.
    llm = new AnthropicBedrockMantle({
      awsRegion: process.env.AWS_REGION ?? "us-west-2",
    }) as unknown as PlaygroundLlm;
  } else {
    if (!env.ANTHROPIC_API_KEY) return null;
    llm = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  cached = { key, llm };
  return llm;
}
