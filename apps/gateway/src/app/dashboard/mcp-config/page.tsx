import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { SetupInstructions } from "@/components/setup-instructions";

export const dynamic = "force-dynamic";

/**
 * The MCP config, on a route.
 *
 * It had none. The block was mounted as the LAST element of the dashboard and
 * the only in-app way to reach it was a button calling scrollIntoView, so it
 * could be linked to by nobody. Giving it an address is a promotion in
 * navigability even though the ticket frames the change as a demotion in
 * prominence: it stops being the first thing a new user meets, and starts
 * being something they can find on purpose.
 *
 * THE SESSION CHECK IS NOT REDUNDANT WITH THE MIDDLEWARE. `proxy.ts` gates
 * `/dashboard/*` on the session cookie being PRESENT, not on it being valid,
 * so any non-empty value walks past it. Verified against production from a
 * browser with no session: no cookie redirects to login, a forged one renders
 * this page. Nothing sensitive was exposed (the config is derived from the
 * request origin, not from a token), but "renders a shell to anyone" is not a
 * property this route should have, and it became the cap panel's primary
 * destination. `/dashboard/usage` already did this; this route did not.
 *
 * The real fix is the middleware validating the token so per-page checks can
 * be retired. That is tracked separately. Until it lands, a route that matters
 * checks for itself.
 */
export default async function McpConfigPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-foreground">
        MCP config
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Use your connected accounts from Claude, Cursor, or any other MCP
        client.
      </p>
      <div className="mt-6">
        <SetupInstructions sourcePrefix="wizard" />
      </div>
    </div>
  );
}
