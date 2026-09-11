import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { revokeApiKey } from "@/gateway/bearer-auth";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DELETE: revokes one of the caller's live keys (SCRUM-245). A foreign id,
 * an unknown id and an already revoked key all answer the same 404, so the
 * route is not an existence oracle for other users' keys. */
const deleteHandler = withRoute<Ctx>(async (userId, _request, ctx) => {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const revoked = await revokeApiKey(db, userId, id);
  if (!revoked) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});

export const DELETE = (request: Parameters<typeof deleteHandler>[0], ctx: Ctx) => deleteHandler(request, ctx);
