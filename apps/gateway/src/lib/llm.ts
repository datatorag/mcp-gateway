import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { getEnv } from "@datatorag-mcp/config";

// Provider instances are stateless and safe to share. Keyed by the API key so
// a config change (tests, env reload) gets a fresh instance.
let cachedModel: { key: string; model: LanguageModel } | null = null;

/** The playground's model, or null when the playground is disabled
 * (no ANTHROPIC_API_KEY set). */
export function getPlaygroundModel(): LanguageModel | null {
  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) return null;

  const key = env.ANTHROPIC_API_KEY;
  if (cachedModel?.key === key) return cachedModel.model;

  const model = createAnthropic({ apiKey: key })(env.PLAYGROUND_MODEL);
  cachedModel = { key, model };
  return model;
}
