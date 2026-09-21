"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { RunSummary } from "@/gateway/tests/read";

/**
 * Starting a run and reading the history (SCRUM-303).
 *
 * The confirm control is inline and two-step rather than a popover: the
 * dashboard shell clips inline floating elements, and a control that starts
 * something which sends mail must never be half visible.
 */
export function RunsPanel({
  initialRuns,
  caseCount,
}: {
  initialRuns: RunSummary[];
  caseCount: number;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [confirming, setConfirming] = useState<null | "all" | 1 | 2>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const listed = await fetch("/api/admin/tests/runs");
    if (listed.ok) setRuns((await listed.json()).runs ?? []);
  }, []);

  /* THE LIST REFRESHES ITSELF WHILE A RUN IS GOING (SCRUM-303).
   *
   * It did not, and the symptom was the one that wastes somebody's
   * afternoon: a watcher sat on this page while a run started, finished in
   * 23 seconds, and the row still said `running` until they reloaded. The
   * page had a poll on the run DETAIL view and none here, so the first
   * thing anyone looks at was the one thing that never updated, and the
   * elapsed time they read off it was their own waiting rather than the
   * run's.
   *
   * It polls only while a run is actually running and stops as soon as none
   * is, so an idle admin page is not a request every three seconds forever.
   * A failed poll is ignored rather than surfaced: a dropped request during
   * a deploy is not something to tell an operator about, and the next tick
   * fixes it. */
  const anyRunning = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => {
      void reload().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [anyRunning, reload]);

  async function start(scope: "all" | 1 | 2) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/tests/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scope === "all" ? {} : { tier: scope }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          res.status === 409
            ? `A run is already in progress (${body.run_id ?? "unknown"}).`
            : (body.error ?? "Could not start the run.")
        );
        return;
      }
      await reload();
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-foreground">Tests</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        The gateway runs its own suite against itself, as a client of its own MCP endpoint.
        A run sends mail and creates files, always to the fixture account, and cleans up
        after itself. {caseCount === 0
          ? "No cases are registered yet, so a run reports every served tool as uncovered."
          : `${caseCount} cases are registered.`}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {(["all", 1, 2] as const).map((scope) => (
          <div key={String(scope)} className="flex items-center gap-2">
            {confirming === scope ? (
              <>
                <span className="text-sm text-muted-foreground">
                  This sends mail and creates files. Start it?
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => start(scope)}
                  className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
                >
                  {busy ? "Starting..." : "Yes, start"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(scope)}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                {scope === "all" ? "Run everything" : `Run tier ${scope}`}
              </button>
            )}
          </div>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <h2 className="mt-8 font-display text-lg font-semibold text-foreground">History</h2>
      {runs.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No runs yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-medium">Started</th>
                <th className="py-2 pr-4 font-medium">Where</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Totals</th>
                <th className="py-2 pr-4 font-medium">Gateway</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.run_id} className="border-t border-border">
                  <td className="py-2 pr-4">
                    <Link href={`/dashboard/admin/tests/${run.run_id}`} className="underline">
                      {new Date(run.started_at).toLocaleString()}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{run.environment}</td>
                  <td className="py-2 pr-4">{run.status}</td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {run.totals.pass}P {run.totals.fail}F {run.totals.skip}S {run.totals.uncovered}U
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {run.gateway_sha ? run.gateway_sha.slice(0, 7) : "sha unknown"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
