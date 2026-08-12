import { NextResponse } from "next/server";
import { withRoute } from "@/lib/with-route";
import { listThreadsForUser } from "@/gateway/playground/threads";
import { fallbackTitle } from "@/gateway/playground/thread-title";

export const dynamic = "force-dynamic";

/**
 * The user's conversations, newest first.
 *
 * NO AUTHORIZATION LOGIC LIVES HERE, deliberately. `withRoute` resolves the
 * session and the gate in `playground/threads.ts` decides what that user may
 * see. A route that did its own filtering would be a second place to get it
 * right, which is how the dashboard ended up with some pages checking the
 * session and others not.
 *
 * The fallback title is applied at render time rather than backfilled: threads
 * that predate titling have no first message we can cheaply reach from here,
 * and a date is something true we already hold.
 */
export const GET = withRoute(async (userId) => {
  const threads = await listThreadsForUser(userId);
  return NextResponse.json({
    threads: threads.map((t) => ({
      id: t.id,
      title: t.title.trim() !== "" ? t.title : fallbackTitle(t.updatedAt),
      updatedAt: t.updatedAt,
    })),
  });
}, { logContext: "[playground] list threads" });
