import { AgentClient } from "./agent-client";

export const dynamic = "force-dynamic";

/** `?welcome=1` is set by the post-login redirect for a new user, and is the
 * only way this page can tell "landed here" from "navigated here". */
export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { welcome } = await searchParams;
  return <AgentClient isDefaultView={welcome === "1"} />;
}
