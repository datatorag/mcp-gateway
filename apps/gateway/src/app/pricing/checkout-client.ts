/**
 * Client-side half of the Pro checkout handshake, kept free of DOM/react so
 * every branch is unit-testable: the caller navigates, this decides where.
 *
 * The server (`/api/billing/checkout`) owns everything that matters — the
 * authenticated user↔customer mapping, the price id, the session creation.
 * Nothing here grants or claims anything; a redirect to Stripe is an intent,
 * and the plan only ever changes when the subscription webhook lands.
 */

export type CheckoutInterval = "monthly" | "yearly";

export type CheckoutOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "error"; message: string };

const TRY_AGAIN =
  "Checkout didn't start. Try again in a minute, or talk to us and we'll sort it out.";

export async function startProCheckout(
  interval: CheckoutInterval,
  fetchFn: typeof fetch = fetch
): Promise<CheckoutOutcome> {
  let res: Response;
  try {
    res = await fetchFn("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interval }),
    });
  } catch {
    return { kind: "error", message: TRY_AGAIN };
  }

  // Not signed in: through login and back to this page. `next` is validated
  // server-side by postLoginDestination(); a NEW user returns here carrying
  // ?signup=1, which is why the pricing page mounts useSignupConversion.
  if (res.status === 401) {
    return {
      kind: "redirect",
      url: `/auth/login?next=${encodeURIComponent("/pricing")}`,
    };
  }

  // Already on Pro — there is nothing to buy.
  if (res.status === 409) {
    return { kind: "redirect", url: "/dashboard" };
  }

  if (!res.ok) {
    return { kind: "error", message: TRY_AGAIN };
  }

  const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
  if (body && typeof body.url === "string" && body.url) {
    return { kind: "redirect", url: body.url };
  }
  return { kind: "error", message: TRY_AGAIN };
}
