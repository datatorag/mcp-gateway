import { NextResponse, type NextRequest } from "next/server";
import { withAdminRoute } from "@/lib/with-admin-route";
import { db } from "@/lib/db";
import { readRunDiff } from "@/gateway/tests/read";

/** The diff between two runs (SCRUM-303). `against` may name a run from a
 * different environment: that comparison is the deploy gate. */

type Ctx = { params: Promise<{ id: string }> };

const handler = withAdminRoute<Ctx>(
  async (_userId, req: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const against = new URL(req.url).searchParams.get("against");
    if (!against) {
      return NextResponse.json({ error: "against is required" }, { status: 400 });
    }
    const diff = await readRunDiff(db, id, against);
    if (!diff) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(diff);
  },
  { logContext: "[api] admin tests diff" }
);

/** Context required on the export; see the sibling route for why. */
export const GET = (request: Parameters<typeof handler>[0], ctx: Ctx) => handler(request, ctx);
