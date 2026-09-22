"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ResultsPage, RunStatus } from "@/gateway/tests/read";

type Result = ResultsPage["results"][number];

/** One run's results (SCRUM-303). Polls while the run is going, so progress
 * is visible rather than a page that has to be reloaded to mean anything. */
export function RunDetail({ run, initialResults }: { run: RunStatus; initialResults: Result[] }) {
  const [current, setCurrent] = useState(run);
  const [results, setResults] = useState(initialResults);
  const [showPasses, setShowPasses] = useState(false);

  useEffect(() => {
    if (current.status !== "running") return;
    const poll = async () => {
      const res = await fetch(`/api/admin/tests/runs/${run.run_id}`);
      if (!res.ok) return;
      const body = await res.json();
      setCurrent(body.run);
      setResults(body.results ?? []);
    };
    // Paused while the tab is hidden, as the runs panel does: a background
    // tab polling every three seconds is twenty admin reads a minute for
    // nobody.
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      stop();
      if (document.hidden) return;
      void poll().catch(() => {});
      timer = setInterval(() => void poll().catch(() => {}), 3000);
    };
    if (!document.hidden) timer = setInterval(() => void poll().catch(() => {}), 3000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [current.status, run.run_id]);

  useEffect(() => {
    if (!showPasses) return;
    void (async () => {
      const res = await fetch(
        `/api/admin/tests/runs/${run.run_id}?status=pass&status=fail&status=skip&status=uncovered`
      );
      if (res.ok) setResults((await res.json()).results ?? []);
    })();
  }, [showPasses, run.run_id]);

  return (
    <div>
      <Link href="/dashboard/admin/tests" className="text-sm underline text-muted-foreground">
        Back to runs
      </Link>
      <h1 className="mt-2 font-display text-2xl font-bold text-foreground">
        Run {run.run_id.slice(0, 8)}
      </h1>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <Fact label="Status" value={current.status} />
        <Fact label="Where" value={current.environment} />
        <Fact label="Green" value={current.green ? "yes" : "no"} />
        <Fact label="Tools served" value={String(current.tools_served)} />
        <Fact label="Gateway" value={current.gateway_sha?.slice(0, 7) ?? "sha unknown"} />
        <Fact
          label="Plugins"
          value={
            Object.entries(current.plugin_shas)
              .map(([slug, sha]) => `${slug} ${sha ? sha.slice(0, 7) : "unknown"}`)
              .join(", ") || "none"
          }
        />
      </dl>

      <p className="mt-4 font-mono text-xs text-muted-foreground">
        {current.totals.pass} pass · {current.totals.fail} fail · {current.totals.skip} skip ·{" "}
        {current.totals.uncovered} uncovered · {current.done} recorded
      </p>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showPasses} onChange={(e) => setShowPasses(e.target.checked)} />
        Show passes too
      </label>

      {results.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {current.status === "running" ? "Running..." : "Nothing to show."}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {results.map((r) => (
            <li key={r.case_id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                <span className="font-mono">{r.case_id}</span>
                <span className="font-medium">{r.status}</span>
                {r.cleanup === "leaked" && <span className="text-red-600">cleanup leaked</span>}
                <span className="text-muted-foreground">{r.duration_ms} ms</span>
              </div>
              {r.evidence && (
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                  {r.evidence}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
