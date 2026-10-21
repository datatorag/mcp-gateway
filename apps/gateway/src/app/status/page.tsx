import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { db } from "@/lib/db";
import { getStatusModel } from "@/lib/status/read-model";
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";
import { StatusView } from "./status-view";

/** Per request: one indexed lookup of the newest full prod run, and the
 * model from memory unless that run is new (SCRUM-431). */
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "The latest end-to-end check of DataToRAG on production: what works, by service, from a test run that calls the tools the way you would.";

export const metadata: Metadata = {
  title: "Status | DataToRAG",
  description: DESCRIPTION,
  alternates: { canonical: "https://datatorag.com/status" },
  twitter: SOCIAL_TWITTER,
  openGraph: {
    ...SOCIAL_OPEN_GRAPH,
    title: "Status | DataToRAG",
    description: DESCRIPTION,
    type: "website",
    url: "https://datatorag.com/status",
  },
};

export default async function StatusPage() {
  const now = new Date();
  const model = await getStatusModel(db, now);
  return (
    <>
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-6 pb-16 pt-32 sm:pb-20 sm:pt-36">
          <div className="animate-fade-in-up">
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Status</h1>
            <p className="mt-3 text-muted-foreground">
              A test run calls the tools on production the way you would, with real accounts, and checks what comes
              back. This page is the latest full run: what works, by service, with the 30 days before it. Tools no
              check exercises yet are listed as such.
            </p>
          </div>
          <StatusView model={model} now={now} />
        </div>
      </main>
    </>
  );
}
