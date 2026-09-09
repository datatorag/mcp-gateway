import { PostHog } from "posthog-node";
import { getEnv } from "@datatorag-mcp/config";
import { posthogPolicy, type PosthogPolicy } from "./analytics-guard";

const POSTHOG_HOST = "https://us.i.posthog.com";

let client: PostHog | null = null;
let announced = false;

/** What the policy says for this process, from the validated config. */
function policy(): PosthogPolicy {
  const env = getEnv();
  return posthogPolicy({
    nodeEnv: env.NODE_ENV,
    allow: env.POSTHOG_ALLOW_NONPRODUCTION,
    hasKey: Boolean(env.POSTHOG_API_KEY),
  });
}

/** The server client, or null when analytics is off (SCRUM-228: outside
 * production without the explicit flag, or with no key). Every capture
 * already treats null as "not configured", so nothing else changes; the
 * reason is logged once, and `/health` carries it for anything that reads
 * state rather than logs. Never a hard exit. */
export function getPosthog(): PostHog | null {
  const p = policy();
  if (!p.on) {
    if (!announced) {
      announced = true;
      console.warn(`[posthog] analytics off: ${p.reason}`);
    }
    return null;
  }
  if (!client) {
    client = new PostHog(getEnv().POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      flushAt: 20,
      flushInterval: 10_000,
    });
  }
  return client;
}

/** The state `/health` reports, decided by the same function that gates
 * the client. */
export function posthogState(): { analytics: "on" | "off"; analytics_reason: string } {
  const p = policy();
  return { analytics: p.on ? "on" : "off", analytics_reason: p.reason };
}

export async function shutdownPosthog(): Promise<void> {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
