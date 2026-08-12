import { NextResponse, type NextRequest } from "next/server";
import { withRoute } from "@/lib/with-route";
import {
  deleteThreadForUser,
  readThreadForUser,
} from "@/gateway/playground/threads";
import { replayThread } from "@/gateway/playground/replay";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/* WHY THESE ARE THIN NAMED FUNCTIONS RATHER THAN DIRECT EXPORTS OF
 * `withRoute(...)`.
 *
 * `withRoute` types its context argument as OPTIONAL, so that routes with no
 * params satisfy Next's generated validator. A route WITH params has the
 * opposite requirement: Next demands the second argument be a required
 * `RouteContext`, and rejects `Ctx | undefined` outright. It rejects it at
 * BUILD time, not from `tsc`, so this is invisible until a production build
 * runs.
 *
 * Delegating keeps the shared wrapper's session check and rate limit exactly
 * as they are for every other route, rather than loosening it for all of them
 * to satisfy this one. */

/** The same answer for a thread that is not yours and one that never existed.
 *
 * NOT FOUND, NEVER FORBIDDEN. A 403 on a foreign id and a 404 on an unknown
 * one turns this route into an oracle that confirms whether a given
 * conversation exists on somebody else's account. The gate already returns one
 * indistinguishable value for both cases; this keeps that property at the
 * wire. */
const notFound = () =>
  NextResponse.json({ error: "Not found" }, { status: 404 });

/** One conversation's messages, converted into what the UI can render. */
const readHandler = withRoute<Ctx>(async (userId, _req, ctx) => {
  const { id } = await ctx.params;
  const stored = await readThreadForUser(userId, id);
  if (stored === null) return notFound();
  return NextResponse.json({ messages: replayThread(stored) });
}, { logContext: "[playground] read thread" });

export async function GET(req: NextRequest, ctx: Ctx) {
  return readHandler(req, ctx);
}

/** Delete means gone.
 *
 * The storage primitive behind this takes an id and no owner, so the gate is
 * the only thing preventing a stranger's conversation being destroyed by
 * guessing an id. It is checked there, once, and mutation-tested. */
const deleteHandler = withRoute<Ctx>(async (userId, _req, ctx) => {
  const { id } = await ctx.params;
  const removed = await deleteThreadForUser(userId, id);
  if (!removed) return notFound();
  return NextResponse.json({ deleted: true });
}, { logContext: "[playground] delete thread" });

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return deleteHandler(req, ctx);
}
