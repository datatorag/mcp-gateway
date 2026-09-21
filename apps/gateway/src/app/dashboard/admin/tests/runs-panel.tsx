"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { RunSummary } from "@/gateway/tests/read";
import { REGROUP_PENDING, SCENARIOS } from "@/gateway/tests/scenarios";

/**
 * Starting a run and reading the history (SCRUM-303).
 *
 * The confirm control is inline and two-step rather than a popover: the
 * dashboard shell clips inline floating elements, and a control that starts
 * something which sends mail must never be half visible.
 */
/**
 * Only the runs that really put mail in an inbox say so.
 *
 * "Everything" is the dangerous one and it was briefly the one that stopped
 * warning: deriving it from the scenario flags alone said "no mail" while
 * every mail case still ran, because those cases were not yet regrouped
 * into the Gmail scenario. A warning that is wrong on the run that sends
 * the most mail is worse than no warning.
 *
 * So while ANY case is still unplaced, "everything" assumes mail. It cannot
 * know what a pending case does, and the safe assumption is the one that
 * shows the stronger words. When the regroup finishes and the pending list
 * empties, this falls back to the flags, which is then the whole truth.
 */
export function sendsMail(scope: string): boolean {
  if (scope === "all") return REGROUP_PENDING.length > 0 || SCENARIOS.some((s) => s.sendsMail);
  return SCENARIOS.find((s) => s.key === scope)?.sendsMail === true;
}

export function RunsPanel({
  initialRuns,
  caseCount,
}: {
  initialRuns: RunSummary[];
  caseCount: number;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [confirming, setConfirming] = useState<null | string>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The run this page started, until it shows up in the list. See the poll. */
  const [startedId, setStartedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const listed = await fetch("/api/admin/tests/runs");
    if (listed.ok) setRuns((await listed.json()).runs ?? []);
  }, []);

  /* THE LIST REFRESHES ITSELF, AND NOT ONLY WHEN IT ALREADY KNOWS A RUN
   * IS GOING (SCRUM-303).
   *
   * The first version polled only while `runs` already held a `running`
   * row, which reads fine and is a trap: the condition is computed from the
   * very list the poll exists to fetch. A page rendered when the history
   * was EMPTY therefore never polled at all, and "No runs yet" was an
   * absorbing state, nothing could ever leave it. That is not a corner: it
   * is every page load on a fresh database, and it is what Manuel sat in
   * front of while a run he had started ran to completion in another tab.
   * The server log for that run is unambiguous, the list endpoint was not
   * requested once between the start and the next manual reload.
   *
   * So the poll always runs. The cadence, not its existence, is what the
   * state decides: 3 s while something is in flight, 15 s otherwise, which
   * is cheap enough for a page only admins open and is what lets a run
   * started ANYWHERE ELSE appear here, from another tab, from the MCP tool,
   * from a deploy gate.
   *
   * `startedId` covers the gap between starting a run and seeing it: until
   * the id we were handed shows up in the list, this page keeps the fast
   * cadence, so a refresh that failed right after the start is recovered by
   * the next tick rather than waiting for somebody to press reload.
   *
   * A hidden tab polls not at all, and refetches the moment it is looked at
   * again. That keeps the original intent, an idle page is quiet, without
   * paying for it in correctness.
   *
   * A failed poll stays ignored: a dropped request during a deploy is not
   * something to tell an operator about, and the next tick fixes it. */
  const awaitingStarted = startedId !== null && !runs.some((r) => r.run_id === startedId);
  const inFlight = runs.some((r) => r.status === "running") || awaitingStarted;
  useEffect(() => {
    const period = inFlight ? 3000 : 15000;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const schedule = () => {
      stop();
      timer = setInterval(() => void reload().catch(() => {}), period);
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
        return;
      }
      void reload().catch(() => {});
      schedule();
    };
    if (!document.hidden) schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [inFlight, reload]);

  async function start(scope: "all" | string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/tests/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scope === "all" ? {} : { scenario: scope }),
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
      setStartedId(typeof body.run_id === "string" ? body.run_id : null);
      /* The refresh is attempted here for the common case and allowed to
       * fail: the poll above is what GUARANTEES the row appears, and an
       * unhandled rejection out of a click handler would leave the page
       * silently stale, which is the defect this whole block exists for. */
      await reload().catch(() => {});
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
        {["all", ...SCENARIOS.map((s) => s.key)].map((scope) => (
          <div key={scope} className="flex items-center gap-2">
            {confirming === scope ? (
              <>
                <span className="text-sm text-muted-foreground">
                  {/* THE WARNING NAMES WHAT THIS RUN ACTUALLY DOES. The old
                      dialog warned about sending mail on tier runs that sent
                      none, which is how a warning stops being read. */}
                  {sendsMail(scope)
                    ? "This sends mail and creates files. Start it?"
                    : "This creates and deletes files. Start it?"}
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
                title={scope === "all" ? undefined : SCENARIOS.find((s) => s.key === scope)?.title}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                {scope === "all" ? "Run everything" : scope}
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
