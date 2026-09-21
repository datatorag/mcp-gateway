import { getEnv } from "@datatorag-mcp/config";
import type { TestCase } from "../types";

/**
 * A5 (Gateway scenario): /health reports whether analytics is on, and in production it
 * must be on.
 *
 * The failure this catches is an ABSENCE. A production box with the
 * environment variable unset passes its own guard's "not production" test and
 * silently stops reporting; the only symptom is missing events, which reads
 * like a quiet day. So an absent field is a failure exactly like an "off"
 * value.
 *
 * The on/production half is asserted only where it means something. A local
 * run SHOULD have analytics off, so asserting "on" everywhere would make the
 * case fail for being correct.
 */
export const a5Analytics: TestCase = {
  id: "A5",
  title: "/health reports the analytics guard",
  covers: [],
  accounts: [],
  run: async (ctx) => {
    const res = await ctx.http(`/health?cb=${ctx.stamp}`);
    const body = (await res.json()) as Record<string, unknown>;

    for (const field of ["analytics", "analytics_reason"]) {
      if (!(field in body)) {
        throw new Error(`/health does not carry ${field}, so the analytics guard reports nothing`);
      }
    }
    ctx.evidence(`analytics=${String(body.analytics)} reason=${String(body.analytics_reason)}`);

    if (getEnv().TEST_RUNNER_ENVIRONMENT !== "prod") {
      ctx.evidence("not the production environment, so on/production is not asserted here");
      return;
    }
    if (body.analytics !== "on" || body.analytics_reason !== "production") {
      throw new Error(
        `production is running with analytics ${String(body.analytics)} (${String(body.analytics_reason)})`
      );
    }
  },
};
