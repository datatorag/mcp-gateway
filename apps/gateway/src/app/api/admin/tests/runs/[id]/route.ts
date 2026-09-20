import { NextResponse, type NextRequest } from "next/server";
import { withAdminRoute } from "@/lib/with-admin-route";
import { db } from "@/lib/db";
import { readRunResults, readRunStatus } from "@/gateway/tests/read";

/** One run: its status, and a page of its results (SCRUM-303). */

type Ctx = { params: Promise<{ id: string }> };

const handler = withAdminRoute<Ctx>(
  async (_userId, req: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const status = await readRunStatus(db, id);
    if (!status) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const url = new URL(req.url);
    const statuses = url.searchParams.getAll("status");
    const kinds = url.searchParams.getAll("kind");
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const results = await readRunResults(db, id, { statuses, kinds, cursor });

    return NextResponse.json({ run: status, ...results });
  },
  { logContext: "[api] admin tests run" }
);

/** Re-exported with the context REQUIRED, because the wrapper takes it
 * optionally so param-less routes typecheck, and Next's route validator
 * rejects that shape on a dynamic segment. Same pattern as /api/keys/[id]. */
export const GET = (request: Parameters<typeof handler>[0], ctx: Ctx) => handler(request, ctx);
