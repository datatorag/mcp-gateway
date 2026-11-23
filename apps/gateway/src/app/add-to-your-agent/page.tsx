import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { AddToAgent } from "@/components/add-to-agent";
import { getSessionUserId } from "@/lib/session";
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";

const TITLE = "Add DataToRAG to your agent | DataToRAG";
const DESCRIPTION =
  "Pick the agent you use, Claude, ChatGPT, Cursor, Codex, or any MCP client, and add DataToRAG to it in one step.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://datatorag.com/add-to-your-agent" },
  twitter: SOCIAL_TWITTER,
  openGraph: {
    ...SOCIAL_OPEN_GRAPH,
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    url: "https://datatorag.com/add-to-your-agent",
  },
};

export const dynamic = "force-dynamic";

/**
 * The "Add to your agent" block's own address (SCRUM-503): one stable link
 * for anything that points a person at the client step, an email included,
 * whether they are signed in or not. `?client=<id>` opens a given client
 * (the ids in `lib/mcp-clients.ts`). Signed in, the block marks the clients
 * already connected.
 */
export default async function AddToYourAgentPage() {
  const signedIn = (await getSessionUserId()) !== null;
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 pb-16 pt-32 sm:pt-36">
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
          Add DataToRAG to your agent
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Your agent gets your Google Workspace, Atlassian, and Notion tools
          through one connection. Pick the client you use below.
        </p>
        <AddToAgent placement="page" signedIn={signedIn} heading={false} className="mt-6" />
        <p className="mt-6 text-sm text-muted-foreground">
          {signedIn ? (
            <>
              Your agent works on the accounts you connect.{" "}
              <Link href="/dashboard/connections" className="font-medium text-primary hover:underline">
                Manage connections
              </Link>
            </>
          ) : (
            <>
              The full walkthrough is in{" "}
              <Link href="/docs/getting-started" className="font-medium text-primary hover:underline">
                Getting started
              </Link>
              .
            </>
          )}
        </p>
      </main>
    </>
  );
}
