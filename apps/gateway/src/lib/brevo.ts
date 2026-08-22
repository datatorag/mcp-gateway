import { getEnv } from "@datatorag-mcp/config";

const BREVO_BASE = "https://api.brevo.com/v3";

// Brevo objects are managed in the Brevo console — ids are stable references.
export const BREVO_LIST_PRODUCT_USERS = 4;
export const BREVO_TEMPLATE_WELCOME = 2;
export const BREVO_TEMPLATE_NO_ACTIVATION = 3;

/**
 * The no-activation follow-up is one email per user, but three different
 * emails depending on WHY they stalled (SCRUM-140): never connected, connected
 * with a grant the product cannot use, or connected and never tried anything.
 * Template 3 gave everyone client-configuration instructions, which is the
 * wrong advice for two of those three. It stays defined because it is the
 * live template until this branch deploys; nothing new should send it.
 *
 * Same kind of console reference as the ids above. A send to an id that does
 * not exist fails the POST, which drops the email and alerts ops, so a wrong
 * id here fails in the safe direction.
 */
export const BREVO_TEMPLATE_FOLLOWUP_CONNECT = 4;
export const BREVO_TEMPLATE_FOLLOWUP_PERMISSIONS = 5;
export const BREVO_TEMPLATE_FOLLOWUP_TRY_THIS = 6;

// Founder/test accounts come from INTERNAL_EXCLUDE_EMAILS (comma-separated,
// SSM → server .env — the same env-side list the digest's internal exclusion
// reads, mirroring the PostHog test-account filters). Anyone @datatorag.com
// is always internal. Lifecycle emails must never go to internal addresses.
export function isInternalEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (e.endsWith("@datatorag.com")) return true;
  return getEnv()
    .INTERNAL_EXCLUDE_EMAILS.split(",")
    .some((entry) => entry.trim().toLowerCase() === e && entry.trim() !== "");
}

export function hasBrevoKey(): boolean {
  return !!getEnv().BREVO_API_KEY;
}

/**
 * POST to the Brevo API. Never throws; returns false (and warns) on any
 * failure — lifecycle email must not break signup or the cron loop.
 * When BREVO_API_KEY is absent (not yet in SSM) this is a warned no-op.
 */
async function brevoPost(path: string, body: unknown): Promise<boolean> {
  const apiKey = getEnv().BREVO_API_KEY;
  if (!apiKey) {
    console.warn(`[brevo] BREVO_API_KEY not set — skipping POST ${path}`);
    return false;
  }
  try {
    const res = await fetch(`${BREVO_BASE}${path}`, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[brevo] POST ${path} failed: ${res.status} ${text.slice(0, 300)}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[brevo] POST ${path} error`, err);
    return false;
  }
}

export async function upsertBrevoContact(input: {
  email: string;
  firstName: string;
  signupDate?: Date;
  plan?: string;
}): Promise<boolean> {
  return brevoPost("/contacts", {
    email: input.email,
    updateEnabled: true,
    listIds: [BREVO_LIST_PRODUCT_USERS],
    attributes: {
      FIRSTNAME: input.firstName,
      ...(input.signupDate
        ? { SIGNUP_DATE: input.signupDate.toISOString().slice(0, 10) }
        : {}),
      ...(input.plan ? { PLAN: input.plan } : {}),
    },
  });
}

export async function sendBrevoTemplate(
  templateId: number,
  email: string,
  params: Record<string, string>
): Promise<boolean> {
  return brevoPost("/smtp/email", {
    to: [{ email }],
    templateId,
    params,
  });
}

/**
 * Send a one-off email whose body lives in this repo rather than in a Brevo
 * console template.
 *
 * Templates are right for lifecycle mail that marketing edits without a
 * deploy. They are wrong for anything whose wording is a claim about the
 * product: a console template is copy nobody reviews, outside the accuracy
 * rules every other surface is held to, and invisible to a diff. Anything a
 * stranger receives in our name goes through code review like a page does.
 *
 * `sender` must be a verified Brevo sender or the API rejects the send.
 */
export async function sendBrevoEmail(input: {
  to: string;
  toName?: string;
  subject: string;
  textContent: string;
  htmlContent: string;
  senderEmail: string;
  senderName: string;
  replyTo?: string;
}): Promise<boolean> {
  return brevoPost("/smtp/email", {
    to: [{ email: input.to, ...(input.toName ? { name: input.toName } : {}) }],
    sender: { email: input.senderEmail, name: input.senderName },
    ...(input.replyTo ? { replyTo: { email: input.replyTo } } : {}),
    subject: input.subject,
    textContent: input.textContent,
    htmlContent: input.htmlContent,
  });
}
