import { z } from "zod";

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
  // PostHog
  POSTHOG_API_KEY: z.string().default(""),
  // Stripe
  STRIPE_API_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PRO_MONTHLY_PRICE_ID: z.string().default(""),
  STRIPE_PRO_YEARLY_PRICE_ID: z.string().default(""),
  STRIPE_PAYG_PRICE_ID: z.string().default(""),
  STRIPE_METER_ID: z.string().default(""),
  STRIPE_METER_EVENT_NAME: z.string().default("tool_calls"),
  // Email (Resend)
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default("DataToRAG <billing@datatorag.com>"),
  // Cron auth — Bearer token required to hit /api/cron/* externally
  CRON_SECRET: z.string().default(""),
  // Public URLs for Checkout return
  PUBLIC_APP_URL: z.string().default("http://localhost:8285"),
  // Salt for hashing visitor IPs in the leads table — avoids storing raw PII
  LEADS_IP_SALT: z.string().default(""),
  // Slack notifications (incoming webhook URLs; empty = disabled)
  SLACK_WEBHOOK_LEADS: z.string().default(""),
  SLACK_WEBHOOK_DIGEST: z.string().default(""),
  SLACK_WEBHOOK_ALERTS: z.string().default(""),
  // PostHog Query API (daily digest) — personal API key (NOT the ingestion key)
  POSTHOG_PERSONAL_API_KEY: z.string().default(""),
  POSTHOG_PROJECT_ID: z.string().default(""),
  // Brevo (lifecycle emails: welcome + no-activation follow-up); empty = disabled
  BREVO_API_KEY: z.string().default(""),
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
