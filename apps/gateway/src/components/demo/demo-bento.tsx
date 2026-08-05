/** The scripted-demo bento: three windows replaying authored sessions through
 * the real playground presentation components, each paired with the gap it
 * closes. Entirely client-side — no MCP calls, no API routes, no LLM.
 *
 * The heading is the caller's, the DISCLOSURE IS NOT. The windows replay
 * scripts against sample data, so any surface showing them without saying so
 * is presenting a recording as a live session. It used to live in the home
 * page's subhead with a comment in demo-section warning that it had to travel
 * with the windows; the second surface arrived and the comment was the only
 * thing standing between us and shipping without it. Rendering it here makes
 * that structural instead of remembered.
 *
 * Bento hierarchy is deliberate: Sheets carries the full approval-gate arc
 * and gets the space; Gmail and Jira prove breadth with short scripts. The
 * problem/solution pairs are deliberately unparallel — only sourced
 * limitations are named.
 */

import { CircleCheckIcon, CircleMinusIcon } from "lucide-react";
import { DemoWindow } from "./demo-section";

export const DEMO_DISCLOSURE =
  "A scripted replay with sample data. This is the real playground UI, approval gate included.";

/** The two short-script cells. Sheets is not in here: it carries different
 * copy weight and a different grid span, so listing it alongside these would
 * mean a shape with an exception in it. */
const SHORT_CELLS = [
  {
    id: "gmail",
    problem: "Claude writes the email and stops at the draft.",
    solution: "DataToRAG sends it from your account, once you approve.",
  },
  {
    id: "jira",
    problem:
      "The ticket gets described in chat, then typed into Jira by hand.",
    solution:
      "DataToRAG creates it in your project with the fields already set.",
  },
];

export function DemoBento({
  heading,
  promptHref,
  promptLabel,
}: {
  heading: string;
  /** Composer-shaped link target. Omit both and the windows render with no
   * composer at all — the lead page does exactly that, because a second route
   * into the playground competes with the form that page exists to collect. */
  promptHref?: string;
  promptLabel?: string;
}) {
  return (
    <>
      <div className="animate-fade-in-up text-center">
        <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
          {heading}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          {DEMO_DISCLOSURE}
        </p>
      </div>

      <div
        className="animate-fade-in-up mt-10 grid gap-4 lg:grid-cols-2"
        style={{ animationDelay: "0.1s" }}
      >
        {/* The text is the argument, the window is the evidence: the
            solution line is the largest type in each cell, the problem
            line stays visibly quieter. Neither outranks the section
            heading. */}
        <div className="min-w-0 rounded-2xl border border-border bg-secondary/50 p-5 sm:p-6 lg:col-span-2 lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
          <div className="min-w-0 lg:col-span-5 lg:pt-2">
            {/* Same visual grammar as the hero comparison table:
                muted minus for the gap, primary check for the fix. */}
            <p className="flex items-start gap-2.5 text-base leading-relaxed text-muted-foreground sm:text-lg">
              <CircleMinusIcon
                aria-hidden="true"
                className="mt-1 size-5 shrink-0 text-muted-foreground/60"
              />
              <span>
                Claude reads the sheet you already keep, then hands you rows to
                paste in yourself.
              </span>
            </p>
            <p className="mt-3 flex items-start gap-2.5 font-display text-xl font-semibold leading-snug text-foreground sm:text-2xl">
              <CircleCheckIcon
                aria-hidden="true"
                className="mt-1 size-5 shrink-0 text-primary"
              />
              <span>
                DataToRAG appends them to that same file, after asking you
                first.
              </span>
            </p>
          </div>
          <div className="min-w-0 lg:col-span-7 lg:mt-0 mt-5">
            <DemoWindow
              id="sheets"
              promptHref={promptHref}
              promptLabel={promptLabel}
            />
          </div>
        </div>

        {SHORT_CELLS.map((cell) => (
          <div
            className="flex min-w-0 flex-col rounded-2xl border border-border bg-secondary/50 p-5 sm:p-6"
            key={cell.id}
          >
            <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
              <CircleMinusIcon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground/60"
              />
              <span>{cell.problem}</span>
            </p>
            <p className="mt-2 flex items-start gap-2 text-base font-semibold leading-snug text-foreground">
              <CircleCheckIcon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-primary"
              />
              <span>{cell.solution}</span>
            </p>
            {/* Bottom-anchor the window: the two short cells' text pairs wrap
                differently, so anchoring keeps both chat windows on the same
                baseline across the row. */}
            <div className="mt-4 flex grow flex-col justify-end">
              <DemoWindow
                id={cell.id}
                promptHref={promptHref}
                promptLabel={promptLabel}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
