import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { UsageClient } from "./usage-client";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");
  return <UsageClient />;
}
