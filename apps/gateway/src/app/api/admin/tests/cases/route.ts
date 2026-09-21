import { scenarioOf, stepNumber } from "@/gateway/tests/scenarios";
import { NextResponse } from "next/server";
import { withAdminRoute } from "@/lib/with-admin-route";
import { CASES } from "@/gateway/tests/cases";

/** The registered cases, for the run-one picker and for whoever maintains
 * the smoke sheet's "covered by code" column (SCRUM-303). */

export const GET = withAdminRoute(async () => {
  return NextResponse.json({
    cases: CASES.map((c) => ({
      id: c.id,
      title: c.title,
      scenario: scenarioOf(c.id)?.key ?? null,
      step: stepNumber(c.id) ?? null,
      covers: c.covers,
      accounts: c.accounts,
      fixtures: c.fixtures ?? [],
      needs: c.needs ?? [],
    })),
  });
}, { logContext: "[api] admin tests cases" });
