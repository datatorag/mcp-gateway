import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { buildSuggestions } from "@/gateway/agent/suggestions";

export const dynamic = "force-dynamic";

/**
 * Three concrete next actions, named from the user's own files.
 *
 * Identity comes from the session via `withRoute`. It takes no user id, no
 * account id and no email from the caller, deliberately: this reads one
 * person's Drive, and a caller-supplied identity here would be an IDOR wearing
 * a convenience.
 */
export const GET = withRoute(async (userId) => {
  const suggestions = await buildSuggestions(db, userId);
  return NextResponse.json({ suggestions });
});
