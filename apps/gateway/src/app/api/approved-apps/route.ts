import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { listApprovedApps } from "@/gateway/oauth/approved-apps";
import { endGrantForClient, InternalClientError } from "@/gateway/oauth/grants";
import { trackApprovedAppRemoved } from "@/gateway/track";

export const dynamic = "force-dynamic";

/** A registered client id is a UUID (`oauth/register.ts`). Anything else,
 * the dashboard's own `"web"` included, names no app. */
const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/approved-apps: the clients the signed-in user approved, for the
// Connections page.
export const GET = withRoute(async (userId) => {
  return NextResponse.json({ apps: await listApprovedApps(db, userId) });
});

// DELETE /api/approved-apps?clientId=<id>: end the signed-in user's grant to
// one client. The user comes from the session and nothing else, so the id can
// only ever name this user's rows. A client this user never approved, or
// already removed, answers the same success: a 404 would say whether an id
// exists for somebody else.
export const DELETE = withRoute(async (userId, request) => {
  const clientId = request.nextUrl.searchParams.get("clientId") ?? "";
  if (!CLIENT_ID.test(clientId)) {
    return NextResponse.json({ error: "Missing or invalid clientId" }, { status: 400 });
  }
  try {
    const { removed } = await endGrantForClient(db, userId, clientId);
    if (removed) await trackApprovedAppRemoved(db, userId, clientId);
  } catch (err) {
    if (!(err instanceof InternalClientError)) throw err;
    return NextResponse.json({ error: "Missing or invalid clientId" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}, { logContext: "[approved-apps] remove failed" });
