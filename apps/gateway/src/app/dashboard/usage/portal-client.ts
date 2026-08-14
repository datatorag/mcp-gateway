/**
 * Client half of the billing-portal handshake, DOM-free so every branch is
 * unit-testable. Same shape as the pricing page's checkout client: the server
 * owns the customer mapping and session creation; this only decides where the
 * browser goes next. Nothing here changes plan state — cancellation happens
 * inside Stripe's portal, and the subscription webhooks are the only writer
 * of users.plan.
 */

import { isStripeHostedUrl } from "@/lib/stripe-hosted-url";

export type PortalOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "error"; message: string };

const TRY_AGAIN =
  "The billing portal didn't open. Try again in a minute, or contact us and we'll sort it out.";

export async function openBillingPortal(
  fetchFn: typeof fetch = fetch
): Promise<PortalOutcome> {
  let res: Response;
  try {
    res = await fetchFn("/api/billing/portal", { method: "POST" });
  } catch {
    return { kind: "error", message: TRY_AGAIN };
  }

  // Session expired under the open page: through login and straight back.
  if (res.status === 401) {
    return {
      kind: "redirect",
      url: `/auth/login?next=${encodeURIComponent("/dashboard/usage")}`,
    };
  }

  // 400 = no Stripe customer on record. The button only renders for plan=pro,
  // and the webhook that sets pro requires the customer link, so reaching
  // this means something is genuinely wrong on our side — say so instead of
  // pretending a retry will fix it.
  if (res.status === 400) {
    return {
      kind: "error",
      message:
        "We couldn't find your billing account. Contact us and we'll fix it on our side.",
    };
  }

  if (!res.ok) {
    return { kind: "error", message: TRY_AGAIN };
  }

  const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
  if (body && typeof body.url === "string" && isStripeHostedUrl(body.url)) {
    return { kind: "redirect", url: body.url };
  }
  return { kind: "error", message: TRY_AGAIN };
}
