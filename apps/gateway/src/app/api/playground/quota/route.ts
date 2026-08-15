import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { agentRunCap, periodStatus } from "@/gateway/usage/period";

export const dynamic = "force-dynamic";

/**
 * The chat panel meter's read (SCRUM-94): agent runs used and the effective
 * cap, BEFORE any turn is sent. The per-turn quota headers only exist on a
 * turn's response, so a page that just mounted has nothing to render without
 * this.
 *
 * A NEW ROUTE, checked first as the ticket demanded: /api/setup/status is the
 * onboarding checklist (accounts/agent/first-call) and /api/usage/summary
 * aggregates usage_events — neither carries the run allowance, and grafting
 * a quota onto either would hand their existing pollers a payload they never
 * asked for.
 *
 * `runsCap: null` means EXEMPT (counted, never refused) — the client must
 * render that as its own state, never as 0, NaN, or a free-cap fallback.
 * Same read discipline as the introspection tool: the cap comes from
 * `agentRunCap` (the shared decider) and usage from `periodStatus`, which
 * reports a lapsed period as-is rather than rolling it — the next claimed
 * run rolls, exactly as everywhere else.
 */
export const GET = withRoute(async (userId) => {
  const [cap, status] = await Promise.all([
    agentRunCap(db, userId),
    periodStatus(db, userId),
  ]);
  const used = status?.agentRuns ?? 0;
  return NextResponse.json({
    runsUsed: used,
    runsCap: cap,
    runsRemaining: cap === null ? null : Math.max(0, cap - used),
  });
}, { logContext: "[playground/quota]" });
