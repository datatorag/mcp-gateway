import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { loadConnectionsView } from "@/gateway/connections-view";
import { AGENT_PROMPTS } from "../agent-prompts";
import { AgentClient } from "./agent-client";

export const dynamic = "force-dynamic";

/** `?welcome=1` is set by the post-login redirect - for every login, not just
 * a new user's - and is the only way this page can tell "landed here" from
 * "navigated here".
 *
 * `?signup=1` rides along on the signup landing only, so the pair of params
 * says WHICH login this was, and that is what `landed_from` carries into the
 * event. It is read HERE, server-side, rather than in the client: the signup
 * conversion effect deletes that param from the URL on mount, so a client-side
 * read would be racing a strip that is meant to happen.
 *
 * THE SESSION CHECK IS NOT REDUNDANT WITH THE MIDDLEWARE. `proxy.ts` gates
 * `/dashboard/*` on the session cookie being PRESENT, not valid, so any
 * non-empty value walks past it and this route rendered its shell to anyone
 * holding a made-up cookie. No data leaked (every API behind it answers 401),
 * but this route is the one being promoted to the default post-login
 * destination, and the surface a new user lands on should not be the surface
 * with the weakest check.
 *
 * The class fix is the middleware validating the token so per-page checks can
 * be retired; it is tracked separately and does not gate this. Until then, a
 * route that matters checks for itself.
 *
 * Note for anyone verifying this page locally: a forged cookie no longer gets
 * you here, which was previously the easy way to render it without signing in.
 * That is the point of the change. Use a real session. */
export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{
    welcome?: string;
    signup?: string;
    thread?: string;
    connected?: string;
    connect_error?: string;
    prompt?: string;
  }>;
}) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");
  // The connection state, loaded HERE (SCRUM-206). This is a server
  // component that already holds the user's id, so the answer the empty
  // state branches on is known before first paint; asking the browser to go
  // and find it again after mount is what put a wrong-biased "unknown" state
  // in front of every new user. Same loader as /api/connections, so the
  // shape cannot drift from what a later refetch returns. The two lookups
  // (session, then connections) are sequential by nature: the second needs
  // the first's answer.
  const [{ welcome, signup, thread, connected, connect_error, prompt }, initialConnections] =
    await Promise.all([searchParams, loadConnectionsView(db, userId)]);

  // SEED BY IDENTIFIER, NEVER BY CONTENT (SCRUM-118). The Connections page's
  // prompt cards link here with an INDEX into the shared AGENT_PROMPTS list,
  // and the text is resolved HERE, server-side, from that constant. A free
  // string in this parameter is IGNORED, not sanitised: the seeded prompt is
  // auto-submitted to an agent holding write scopes on the user's accounts,
  // so a crafted link must have no payload to carry - an id that does not
  // resolve seeds nothing at all. Sanitising instead would invite widening.
  const seedPrompt =
    typeof prompt === "string" && /^\d{1,2}$/.test(prompt)
      ? AGENT_PROMPTS[Number(prompt)] ?? null
      : null;
  return (
    <AgentClient
      isDefaultView={welcome === "1"}
      landedFrom={signup === "1" ? "signup" : "login"}
      // The connect round trip's return leg (SCRUM-78): which conversation to
      // reopen, and whether the connect finished. The ids are validated
      // client-side against the service registry / the user's own threads, so
      // a mangled param degrades to a normal landing rather than an error.
      resumeThreadId={typeof thread === "string" && thread !== "" ? thread : null}
      connectedService={
        typeof connected === "string" && connected !== "" ? connected : null
      }
      connectError={
        typeof connect_error === "string" && connect_error !== ""
          ? connect_error
          : null
      }
      seedPrompt={seedPrompt}
      initialConnections={initialConnections}
    />
  );
}
