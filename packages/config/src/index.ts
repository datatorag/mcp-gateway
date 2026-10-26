import { z } from "zod";

/** The keys provider tokens are sealed with (SCRUM-442), parsed from
 * `CONNECTION_TOKEN_KEYS`: a comma-separated list of `<id>:<base64 of 32
 * bytes>`. The first entry seals; every entry opens. */
export type ConnectionTokenKeys = {
  sealing: { id: string; key: Buffer };
  byId: Map<string, Buffer>;
};

const KEY_ID = /^[a-z0-9]{1,16}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Parse the key list, or throw a sentence naming the variable and the entry's
 * position. Never a value: this is a secret, and the error reaches the log. */
export function parseConnectionTokenKeys(raw: string): ConnectionTokenKeys {
  const fail = (why: string): never => {
    throw new Error(`CONNECTION_TOKEN_KEYS ${why}`);
  };
  if (raw.trim() === "") fail("is empty");
  const byId = new Map<string, Buffer>();
  raw.split(",").forEach((entry, i) => {
    const at = `entry ${i + 1}`;
    const colon = entry.indexOf(":");
    if (colon < 0) fail(`${at} is not <id>:<base64 key>`);
    const id = entry.slice(0, colon).trim();
    const encoded = entry.slice(colon + 1).trim();
    if (!KEY_ID.test(id)) fail(`${at} has an id that is not 1 to 16 of a-z and 0-9`);
    if (byId.has(id)) fail(`${at} repeats an id`);
    if (!BASE64.test(encoded)) fail(`${at} is not base64`);
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) fail(`${at} is not a 32-byte key`);
    byId.set(id, key);
  });
  const [id, key] = byId.entries().next().value as [string, Buffer];
  return { sealing: { id, key }, byId };
}

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  GATEWAY_PORT: z.coerce.number().default(8285),
  GATEWAY_BASE_URL: z.string().default("http://localhost:8285"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  // Google OAuth — web login (minimal scopes)
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  // Google OAuth — GWS connection (Workspace scopes)
  GOOGLE_GWS_CLIENT_ID: z.string().default(""),
  GOOGLE_GWS_CLIENT_SECRET: z.string().default(""),
  // Atlassian OAuth — Jira + Confluence
  ATLASSIAN_CLIENT_ID: z.string().default(""),
  ATLASSIAN_CLIENT_SECRET: z.string().default(""),
  // Notion OAuth (SCRUM-366). Optional like the Atlassian pair, so a deploy
  // without them still boots.
  NOTION_OAUTH_CLIENT_ID: z.string().default(""),
  NOTION_OAUTH_CLIENT_SECRET: z.string().default(""),
  // PostHog
  POSTHOG_API_KEY: z.string().default(""),
  /** SCRUM-228: analytics is off outside production unless this is "1". */
  POSTHOG_ALLOW_NONPRODUCTION: z.string().default(""),
  // Stripe
  STRIPE_API_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PRO_MONTHLY_PRICE_ID: z.string().default(""),
  STRIPE_PRO_YEARLY_PRICE_ID: z.string().default(""),
  STRIPE_PAYG_PRICE_ID: z.string().default(""),
  /** SCRUM-231: the Stripe promotion code id (promo_...) the campaign banner
   * applies at checkout. Empty = the hosted page shows the code field instead. */
  STRIPE_PROMOTION_CODE_ID: z.string().default(""),
  STRIPE_METER_ID: z.string().default(""),
  STRIPE_METER_EVENT_NAME: z.string().default("tool_calls"),
  // Cron auth — Bearer token required to hit /api/cron/* externally
  CRON_SECRET: z.string().default(""),
  // Public URLs for Checkout return
  PUBLIC_APP_URL: z.string().default("http://localhost:8285"),
  // Salt for hashing visitor IPs in the leads table — avoids storing raw PII
  LEADS_IP_SALT: z.string().default(""),
  // Slack notifications — Dara bot token + channel ids; empty = disabled
  SLACK_BOT_TOKEN: z.string().default(""),
  SLACK_CHANNEL_LEADS: z.string().default(""),
  SLACK_CHANNEL_DIGEST: z.string().default(""),
  SLACK_CHANNEL_ALERTS: z.string().default(""),
  // PostHog Query API (daily digest) — personal API key (NOT the ingestion key)
  POSTHOG_PERSONAL_API_KEY: z.string().default(""),
  POSTHOG_PROJECT_ID: z.string().default(""),
  // Brevo (lifecycle emails: welcome + no-activation follow-up); empty = disabled
  BREVO_API_KEY: z.string().default(""),
  // From/reply-to on the contact-form confirmation. MUST be a verified Brevo
  // sender or the API rejects the send. Replies are that email's primary ask,
  // so this has to be an inbox someone actually reads — hence a personal
  // address rather than a role one.
  LEADS_CONFIRMATION_FROM: z.string().default("manuel@datatorag.com"),
  // Internal/test traffic excluded from analytics queries (daily digest).
  // Comma-separated; values live in env/SSM only — never in this public repo.
  // Keep mirrored with the PostHog "Internal / Test users" cohort.
  INTERNAL_EXCLUDE_EMAILS: z.string().default(""),
  /** The gateway build's own sha (SCRUM-303), baked into the image as a
   * BUILD ARGUMENT rather than rendered into `.env`: the container has never
   * known which commit it is, because the deploy script writes the sha to a
   * file on the HOST, outside it. A run records this beside each plugin's
   * sha, which is what makes "these eleven results changed between X and Y"
   * answerable. Empty in a local build, and a run then stores null rather
   * than guessing. `/health` does not expose it. */
  GATEWAY_SHA: z.string().default(""),
  /** Which environment a test run says it executed in (SCRUM-303). Defaults
   * to `local` and is set to `prod` only in the production compose file, so
   * a forgotten value can never mislabel a local run as the prod baseline.
   * Never inferred from a hostname. */
  TEST_RUNNER_ENVIRONMENT: z.enum(["local", "prod"]).default("local"),
  /** JSON, parsed by `gateway/tests/fixtures.ts`. Maps the roles and fixture
   * keys a case declares onto real accounts and ids. It is NOT in this repo
   * and never can be: a case names `reader` and `sheet`, never a mailbox or
   * a file id. Absent means every case needing a mapping skips with the
   * reason named; it never falls back to a default account. */
  TEST_RUNNER_FIXTURES: z.string().default(""),
  INTERNAL_EXCLUDE_IDS: z.string().default(""),
  // Dashboard playground (capped LLM chat). Empty ANTHROPIC_API_KEY = playground disabled.
  ANTHROPIC_API_KEY: z.string().default(""),
  PLAYGROUND_MODEL: z.string().default("claude-sonnet-5-5"),
  PLAYGROUND_MESSAGE_CAP: z.coerce.number().default(20),
  // Slack channel for playground feedback (Dara bot); empty = disabled
  SLACK_CHANNEL_FEEDBACK: z.string().default(""),
  /** The keys provider OAuth tokens are sealed with (SCRUM-442). Required,
   * with no default: a gateway that cannot seal must not start, and one
   * that cannot open would refuse every connected service. The format is
   * `parseConnectionTokenKeys`'s; the message names the variable alone. */
  CONNECTION_TOKEN_KEYS: z
    .string({ required_error: "CONNECTION_TOKEN_KEYS is required" })
    .superRefine((raw, ctx) => {
      try {
        parseConnectionTokenKeys(raw);
      } catch (e) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
      }
    }),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

export function getEnv(): Env {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error("Invalid environment variables:", result.error.format());
      process.exit(1);
    }
    _env = result.data;
  }
  return _env!;
}

export { envSchema };
