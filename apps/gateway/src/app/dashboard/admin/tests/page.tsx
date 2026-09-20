import { requireAdminPage } from "@/gateway/admin-page";
import { db } from "@/lib/db";
import { listRuns } from "@/gateway/tests/read";
import { CASES } from "@/gateway/tests/cases";
import { RunsPanel } from "./runs-panel";

export const dynamic = "force-dynamic";

/**
 * The test runner's home (SCRUM-303): start a run, see the history.
 *
 * It awaits the guard itself as well as inheriting the layout's. A server
 * layout and the page beneath it render concurrently, so the layout's
 * notFound() arrives after this page has produced its markup, and that
 * markup ships inside the 404. That is measured, not theoretical.
 */
export default async function AdminTestsPage() {
  await requireAdminPage();
  const runs = await listRuns(db, 25);
  return <RunsPanel initialRuns={runs} caseCount={CASES.length} />;
}
