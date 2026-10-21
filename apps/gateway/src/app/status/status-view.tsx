import { isStale, type CaseState, type DayState, type StatusModel, type ToolState } from "@/lib/status/read-model";

/**
 * The status page body (SCRUM-431). Pure: a model and a clock in, markup
 * out, so a test can render it. Nothing here reads the database, and the
 * model carries nothing the page may not show.
 */

const CASE_WORDS: Record<CaseState, string> = {
  working: "Working",
  failing: "Failing in the latest check",
  not_run: "Not run in the latest check",
};
const TOOL_WORDS: Record<ToolState, string> = {
  working: "Working",
  failing: "Failing",
  not_exercised: "Served, not yet exercised",
  not_run: "Not run",
};
const DOT: Record<CaseState | ToolState, string> = {
  working: "bg-success",
  failing: "bg-destructive",
  not_run: "bg-muted-foreground/40",
  not_exercised: "bg-warning",
};
const CELL: Record<DayState, string> = {
  pass: "bg-success",
  fail: "bg-destructive",
  none: "bg-muted",
};
const CELL_WORDS: Record<DayState, string> = { pass: "all checks passed", fail: "a check failed", none: "no full check" };

export function relativeTime(fromIso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(fromIso)) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

const utcStamp = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

function Dot({ state, muted }: { state: CaseState | ToolState; muted: boolean }) {
  return <span aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full ${muted ? "bg-muted-foreground/40" : DOT[state]}`} />;
}

export function StatusView({ model, now }: { model: StatusModel | null; now: Date }) {
  if (!model) {
    return (
      <p className="mt-12 rounded-lg border border-border p-6 text-muted-foreground">
        No full check has run yet, so there is nothing to show.
      </p>
    );
  }
  const stale = isStale(model, now);
  const { run, counts } = model;
  return (
    <div className="mt-10 space-y-10">
      {stale ? (
        <div role="status" className="rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm text-foreground">
          The last full check finished {relativeTime(run.finishedAt, now)}, at {utcStamp(run.finishedAt)}. The states below
          are from then, not from now.
        </div>
      ) : null}

      <section aria-labelledby="latest" className="rounded-lg border border-border p-5">
        <h2 id="latest" className="text-sm font-medium text-foreground">
          Latest full check
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Started {relativeTime(run.startedAt, now)} ({utcStamp(run.startedAt)}), took {duration(run.durationMs)}.
          {run.leftResidue ? " It left test data behind to clean up." : " It cleaned up after itself."}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Checks working</dt>
            <dd className="font-medium text-foreground">{counts.cases.working}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Checks failing</dt>
            <dd className="font-medium text-foreground">{counts.cases.failing}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tools working</dt>
            <dd className="font-medium text-foreground">{counts.tools.working}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tools not yet exercised</dt>
            <dd className="font-medium text-foreground">{counts.tools.notExercised}</dd>
          </div>
        </dl>
        <p className="mt-4 break-words font-mono text-xs text-muted-foreground">
          gateway {run.gatewaySha ?? "unknown"}
          {run.pluginShas.map((p) => ` · ${p.name} ${p.sha ?? "unknown"}`).join("")}
        </p>
        {counts.cases.notRun > 0 || counts.retired > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {counts.cases.notRun > 0 ? `${counts.cases.notRun} not run in this check. ` : ""}
            {counts.retired > 0 ? `${counts.retired} checks in this run have since been retired.` : ""}
          </p>
        ) : null}
      </section>

      {model.surfaces.map((s) => (
        <section key={s.key} aria-labelledby={`surface-${s.key}`} className="border-t border-border pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id={`surface-${s.key}`} className="font-display text-xl font-semibold text-foreground">
              {s.name}
            </h2>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Dot state={s.state} muted={stale} />
              {CASE_WORDS[s.state]}
            </p>
          </div>

          <ol className="mt-3 flex gap-[2px]" aria-label={`${s.name}, last 30 days`}>
            {s.strip.map((d) => (
              <li
                key={d.day}
                title={`${d.day}: ${CELL_WORDS[d.state]}`}
                className={`h-6 min-w-0 flex-1 rounded-sm ${CELL[d.state]}`}
              >
                <span className="sr-only">{`${d.day}: ${CELL_WORDS[d.state]}`}</span>
              </li>
            ))}
          </ol>

          {s.cases.length > 0 ? (
            <ul className="mt-5 divide-y divide-border">
              {s.cases.map((c) => (
                <li key={c.id} className="flex items-start gap-3 py-2 text-sm">
                  <span className="mt-1.5">
                    <Dot state={c.state} muted={stale} />
                  </span>
                  <span className="min-w-0 flex-1 text-foreground">{c.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {c.state === "working" ? duration(c.durationMs) : CASE_WORDS[c.state]}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {s.tools.length > 0 ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-muted-foreground">Tools</summary>
              <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {s.tools.map((t) => (
                  <li key={t.name} className="flex items-center gap-2 text-sm">
                    <Dot state={t.state} muted={stale} />
                    <code className="min-w-0 truncate font-mono text-xs text-foreground">{t.name}</code>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{TOOL_WORDS[t.state]}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ))}
    </div>
  );
}
