import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { users } from "@datatorag-mcp/db";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { UsageClient } from "./usage-client";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");

  // Plan is read server-side from users.plan — the value the subscription
  // webhooks maintain — so the billing section renders correctly on first
  // paint with no extra client fetch and no flash of the wrong control.
  const [user] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return <UsageClient plan={user?.plan ?? "free"} />;
}
