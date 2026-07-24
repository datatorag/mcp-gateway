import { createAnthropic } from "@ai-sdk/anthropic";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { LanguageModel } from "ai";
import { getEnv } from "@datatorag-mcp/config";

// Provider instances are stateless and safe to share; Bedrock's credential
// chain in particular should be resolved once, not per request. Keyed by
// provider+key so a config change (tests, env reload) gets a fresh instance.
let cachedModel: { key: string; model: LanguageModel } | null = null;

/** The playground's model, or null when the playground is disabled
 * (provider "anthropic" with no ANTHROPIC_API_KEY set). */
export function getPlaygroundModel(): LanguageModel | null {
  const env = getEnv();
  const key = `${env.PLAYGROUND_PROVIDER}:${env.ANTHROPIC_API_KEY}`;
  if (cachedModel?.key === key) return cachedModel.model;

  let model: LanguageModel;
  if (env.PLAYGROUND_PROVIDER === "bedrock") {
    // Instance-IAM auth is NOT the provider default — pass the Node
    // credential chain explicitly (instance profiles, ECS roles, etc.).
    const bedrock = createAmazonBedrock({
      region: process.env.AWS_REGION ?? "us-west-2",
      credentialProvider: fromNodeProviderChain(),
    });
    model = bedrock(env.PLAYGROUND_MODEL);
  } else {
    if (!env.ANTHROPIC_API_KEY) return null;
    model = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(env.PLAYGROUND_MODEL);
  }
  cachedModel = { key, model };
  return model;
}
