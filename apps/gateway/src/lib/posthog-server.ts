import { PostHog } from "posthog-node";
import { getEnv } from "@datatorag-mcp/config";

const POSTHOG_HOST = "https://us.i.posthog.com";

let client: PostHog | null = null;

export function getPosthog(): PostHog | null {
  const apiKey = getEnv().POSTHOG_API_KEY;
  if (!apiKey) return null;
  if (!client) {
    client = new PostHog(apiKey, {
      host: POSTHOG_HOST,
      flushAt: 20,
      flushInterval: 10_000,
    });
  }
  return client;
}

export async function shutdownPosthog(): Promise<void> {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
