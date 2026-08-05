/** The confirmation a lead gets after submitting the contact form.
 *
 * This is the first thing we send automatically to a stranger, in our name,
 * with no human in the loop — so the copy lives here, in a reviewed file,
 * rather than in a Brevo console template nobody diffs.
 *
 * Shape is deliberate. It is written to feel like a reply rather than a
 * campaign: no header image, no button, and a primary ask ("reply to this")
 * that costs no click at all. The on-domain link carries UTMs so a click is
 * visible as landing traffic rather than only as a counter in the mail
 * provider, because a CTA nobody instrumented is a CTA nobody can evaluate.
 */

import { sendBrevoEmail } from "@/lib/brevo";

/** Matches the "— Manuel" signature and the manuel@ sender: a confirmation
 * that looks like it came from a person, because the reply it asks for goes
 * to one. */
export const CONFIRMATION_SENDER_NAME = "Manuel, DataToRAG";

/** Two links, each distinguishable in the click data so a click says WHICH
 * path someone took, not just that they moved. The booking link also appears
 * in the lifecycle templates, so comparing the two is only meaningful while
 * they stay distinguishable — keep them from collapsing into one URL. */
export const CONFIRMATION_CTA_URL =
  "https://datatorag.com/auth/login?utm_source=email&utm_medium=lead_confirmation&utm_campaign=contact_reply";

/** Google appointment schedule, same link the welcome and no-activation
 * templates use. Not on our domain, so PostHog cannot see it — Brevo's
 * per-link click count is the only instrument for this one. */
export const CONFIRMATION_BOOKING_URL =
  "https://calendar.app.google/QLXyn3VVtZWBdUq69";

/** Canonical CASA wording. Google-specific assessment — never phrased so it
 * could read as SOC 2, ISO 27001, or a general audit we have not had. */
const CASA_LINE =
  "We're a Google-verified app, CASA Tier 2 security approved (June 2026).";

/** First token of the submitted name. The form takes one free-text field, so
 * this is a best guess and is only ever used as a greeting — a wrong split
 * reads as informal, never as wrong data. */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function confirmationSubject(name: string): string {
  const first = firstNameOf(name);
  // Lowercase subject on purpose: it is how Manuel writes them, and it reads
  // like a person's reply rather than a system notification.
  return first ? `got your message, ${first}` : "got your message";
}

export function confirmationText(name: string): string {
  const first = firstNameOf(name);
  return [
    first ? `Hey ${first},` : "Hey,",
    "",
    "This is Manuel from DataToRAG, thanks for getting in touch. Your message came through and I'll read it properly and write back, usually within a business day.",
    "",
    "If there's anything that would help me give you a straight answer, just reply to this with it, whatever you're trying to automate and which accounts are involved.",
    "",
    "If you'd rather talk it through, you can grab time on my calendar:",
    "",
    CONFIRMATION_BOOKING_URL,
    "",
    "Or if you want to just try it, connect a Google account and run a real prompt against your own data:",
    "",
    CONFIRMATION_CTA_URL,
    "",
    CASA_LINE,
    "",
    "Cheers,",
    "Manuel",
  ].join("\n");
}

export function confirmationHtml(name: string): string {
  const first = escapeHtml(firstNameOf(name));
  const p = (inner: string) =>
    `<p style="margin:0 0 16px">${inner}</p>`;
  return [
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1C1917">`,
    p(first ? `Hey ${first},` : "Hey,"),
    p(
      "This is Manuel from DataToRAG, thanks for getting in touch. Your message came through and I&rsquo;ll read it properly and write back, usually within a business day."
    ),
    p(
      "If there&rsquo;s anything that would help me give you a straight answer, just reply to this with it, whatever you&rsquo;re trying to automate and which accounts are involved."
    ),
    p(
      `If you&rsquo;d rather talk it through, you can <a href="${CONFIRMATION_BOOKING_URL}">grab time on my calendar</a>.`
    ),
    p(
      `Or if you want to just try it, <a href="${CONFIRMATION_CTA_URL}">connect a Google account</a> and run a real prompt against your own data.`
    ),
    p(CASA_LINE),
    p("Cheers,<br>Manuel"),
    "</div>",
  ].join("");
}

/**
 * Never throws and never blocks the form response — a lead row that saved is
 * a success even when the confirmation does not send. Returns false on any
 * failure, including a missing Brevo key (already a warned no-op upstream).
 */
export async function sendLeadConfirmation(input: {
  name: string;
  email: string;
  senderEmail: string;
}): Promise<boolean> {
  try {
    return await sendBrevoEmail({
      to: input.email,
      // Zod only trims the ends, so an interior CR/LF survives into the To
      // header the provider assembles. It almost certainly strips them; not
      // depending on that is one line.
      toName: input.name.replace(/[\r\n]+/g, " "),
      subject: confirmationSubject(input.name),
      textContent: confirmationText(input.name),
      htmlContent: confirmationHtml(input.name),
      senderEmail: input.senderEmail,
      senderName: CONFIRMATION_SENDER_NAME,
      // Replies are the primary ask, so they have to reach a real inbox.
      replyTo: input.senderEmail,
    });
  } catch (err) {
    console.warn("[leads] confirmation email failed", err);
    return false;
  }
}
