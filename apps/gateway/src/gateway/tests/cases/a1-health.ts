import { getEnv } from "@datatorag-mcp/config";
import type { TestCase } from "../types";

/**
 * A1 (Gateway scenario): the gateway answers.
 *
 * If this fails every result below it is noise, which is why the run aborts
 * on the gate rather than reporting forty cascading failures.
 *
 * The cache-busting parameter is load-bearing: a cached 200 proves the
 * cache, not the gateway. And the path is `/health` exactly; `/healthz`,
 * `/api/health` and `/mcp/health` all answer the Next 404 page, which is a
 * 404 a careless assertion reads as "responded".
 */
export const a1Health: TestCase = {
  id: "A1",
  title: "GET /health answers ok",
  covers: [],
  accounts: [],
  run: async (ctx) => {
    const res = await ctx.http(`/health?cb=${ctx.stamp}`);
    ctx.evidence(`GET /health answered ${res.status}`);
    if (res.status !== 200) throw new Error(`expected 200 from /health, got ${res.status}`);

    const body = (await res.json()) as { status?: string };
    ctx.evidence(`status field: ${JSON.stringify(body.status)}`);
    // The FIELD, not the whole body. An exact-body assertion failed on the
    // day the body became more informative (SCRUM-228).
    if (body.status !== "ok") {
      throw new Error(`expected status "ok", got ${JSON.stringify(body.status)}`);
    }

    const notFound = await ctx.http(`/healthz?cb=${ctx.stamp}`);
    ctx.evidence(`control: /healthz answered ${notFound.status}, so 200 above is the real route`);
    if (notFound.status === 200) {
      throw new Error("/healthz answered 200, so this case cannot tell the route from a catch-all");
    }
    void getEnv;
  },
};
