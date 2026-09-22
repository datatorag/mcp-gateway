import { notFound } from "next/navigation";
import { requireAdminPage } from "@/gateway/admin-page";
import { db } from "@/lib/db";
import { readRunResults, readRunStatus } from "@/gateway/tests/read";
import { RunDetail } from "./run-detail";

export const dynamic = "force-dynamic";

/** One run (SCRUM-303). Guards itself, for the reason the index page gives. */
export default async function AdminTestRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  await requireAdminPage();
  const { runId } = await params;
  const [run, results] = await Promise.all([
    readRunStatus(db, runId),
    readRunResults(db, runId, { statuses: ["fail", "skip", "uncovered"] }),
  ]);
  if (!run) notFound();
  return <RunDetail run={run} initialResults={results?.results ?? []} />;
}
