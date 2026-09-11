import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { createApiKey, listApiKeys } from "@/gateway/bearer-auth";

export const dynamic = "force-dynamic";

/** GET: the caller's keys, newest first. Prefix and dates only; the hash
 * never leaves the table and the raw key was shown once at minting. */
export const GET = withRoute(async (userId) => {
  const keys = await listApiKeys(db, userId);
  return NextResponse.json({ keys });
});

/** POST {name}: mints a key (SCRUM-245). The response is the only time the
 * raw value exists outside the caller's clipboard. */
export const POST = withRoute(async (userId, request) => {
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const made = await createApiKey(db, userId, body?.name);
  if (!made.ok) {
    if (made.reason === "invalid_name") {
      return NextResponse.json({ error: "invalid_name", message: "Give the key a name, up to 60 characters." }, { status: 400 });
    }
    return NextResponse.json({ error: "too_many", message: "You have ten live keys. Revoke one first." }, { status: 409 });
  }
  return NextResponse.json({ key: made.key, rawKey: made.rawKey }, { status: 201 });
});
