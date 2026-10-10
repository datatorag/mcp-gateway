import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { users } from "@datatorag-mcp/db";

/**
 * POST /api/me/connect-helper: the signed-in user dismissed the note under
 * the Google connect button (SCRUM-410).
 *
 * Takes no body and has one effect, on the caller's own row: the dismissal
 * time is set. There is no "show it again" from the client; the note comes
 * back only when the connect callback sees Google grant nothing, which is
 * the server's observation and not something a request can assert.
 */
export const POST = withRoute(async (userId) => {
  await db
    .update(users)
    .set({ connectHelperDismissedAt: new Date() })
    .where(eq(users.id, userId));
  return NextResponse.json({ dismissed: true });
});
