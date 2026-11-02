import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { buildSuggestions } from "@/gateway/agent/suggestions";
import type { SuggestionContext } from "@/gateway/agent/suggestion-generator";
import { CONNECTABLE_SERVICES } from "@/app/dashboard/connections/service-registry";

export const dynamic = "force-dynamic";

const CONTEXTS: readonly SuggestionContext[] = ["first_run", "post_connect", "dashboard"];
/** Every connectable service, from the registry. Naming one only steers the
 * order after its connect; an admin-only service (Slack) has no suggestion
 * of its own, so it changes nothing a non-admin could see. */
const SERVICES = CONNECTABLE_SERVICES.map((s) => s.id);

/**
 * The empty-state suggestions for the session user (SCRUM-110, SCRUM-321):
 * `{ suggestions: [{ id, text }] }`.
 *
 * Identity comes from the session via `withRoute`. It takes no user id,
 * account id or email from the caller, deliberately: this reads one person's
 * inbox and Drive, and a caller-supplied identity here would be an IDOR wearing
 * a convenience. `context` and `service` are checked against fixed lists; an
 * unknown value is the default, never passed through.
 */
export const GET = withRoute(async (userId, req) => {
  const params = new URL(req.url).searchParams;
  const asked = params.get("context");
  const context = CONTEXTS.find((c) => c === asked) ?? "first_run";
  const service = SERVICES.find((s) => s === params.get("service"));
  const suggestions = await buildSuggestions(db, userId, { context, service });
  return NextResponse.json({ suggestions });
});
