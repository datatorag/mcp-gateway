/** The landing page's short comparison: every row of the full table that we
 * have and Anthropic's help page does not describe, at once.
 *
 * The rows are `heroGroups()` from connector-comparison.tsx, passed in from
 * the page, so nothing here is a claim of its own: a row changed in the full
 * table changes this on the same deploy. A built-in cell here never says No.
 * It says "Not described", which is a statement about the vendor's page on
 * the date in the footer and not about what Claude can do; see rule 1 in
 * connector-comparison.tsx.
 *
 * All of it is on the page from the first paint. It used to play one group
 * at a time, which meant a visitor never saw all of the rows. What is left of the motion is one short reveal
 * on load: each row fades in, staggered over about a second, and then nothing
 * moves. The reveal is a CSS class (`hero-reveal` in globals.css) that only
 * exists under prefers-reduced-motion: no-preference, so a reader who asked
 * for less motion gets the finished table and no script decides it. A server
 * component: there is no state left to hold.
 */

import { CircleCheckIcon, CircleMinusIcon } from "lucide-react";
import { NOT_DESCRIBED, NOT_DESCRIBED_SUFFIX, type HeroGroup } from "./connector-comparison";

/** Delay of the first row's reveal, and the step between rows. Every line
 * (group headings, rows, tie lines) starts within a second. */
export const REVEAL_START_S = 0.25;
export const REVEAL_STEP_S = 0.035;

function Mark({ yes }: { yes: boolean }) {
  return yes ? (
    <>
      <CircleCheckIcon aria-hidden="true" className="inline-block size-4 text-blue-200" />
      <span className="sr-only">Yes</span>
    </>
  ) : (
    <>
      <CircleMinusIcon aria-hidden="true" className="inline-block size-4 text-white/30" />
      <span className="sr-only">No</span>
    </>
  );
}

/** The built-in column: a tick when the help page describes the row, the
 * words when it does not. Never a minus sign, which reads as "cannot". */
function BuiltInMark({ described }: { described: boolean }) {
  return described ? (
    <Mark yes />
  ) : (
    <span className="text-[10px] leading-tight text-white/55">
      {NOT_DESCRIBED}
      <span className="sr-only">{NOT_DESCRIBED_SUFFIX}</span>
    </span>
  );
}

export function ComparisonHero({
  groups,
  checkedOn,
}: {
  groups: HeroGroup[];
  /** BUILT_IN_CHECKED_ON, passed in so the page names the one constant. */
  checkedOn: string;
}) {
  let line = 0;
  const reveal = () => ({ animationDelay: `${(REVEAL_START_S + REVEAL_STEP_S * line++).toFixed(2)}s` });

  return (
    <div className="w-full">
      <table className="w-full overflow-hidden rounded-xl border border-white/15 bg-white/5 text-left text-sm backdrop-blur-sm">
        <caption className="sr-only">
          What DataToRAG does that Anthropic&rsquo;s help page does not describe for Claude&rsquo;s built-in Google
          connectors, as of {checkedOn}
        </caption>
        <thead>
          <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/50">
            <th scope="col" className="px-4 py-2">
              <span className="sr-only">Capability</span>
            </th>
            <th scope="col" className="w-20 px-1 py-2 text-center font-medium sm:w-24 sm:px-2">
              Built-in
            </th>
            <th scope="col" className="w-20 px-1 py-2 text-center font-medium text-blue-200 sm:w-24 sm:px-2">
              DataToRAG
            </th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.label} className="text-white/80">
            <tr className="hero-reveal" style={reveal()}>
              <th
                scope="colgroup"
                colSpan={3}
                className="px-4 pb-1 pt-3 lg:pt-2 text-left font-display text-[13px] font-bold text-white"
              >
                {g.label}
              </th>
            </tr>
            {g.rows.map((row) => (
              <tr key={row.capability} className="hero-reveal border-b border-white/10 last:border-b-0" style={reveal()}>
                <th scope="row" className={`px-4 py-2 lg:py-1.5 text-left ${row.emphasis ? "font-semibold text-white" : "font-normal"}`}>
                  {row.capability}
                </th>
                <td className="px-1 py-2 lg:py-1.5 text-center sm:px-2">
                  <BuiltInMark described={row.builtIn} />
                </td>
                <td className="px-1 py-2 lg:py-1.5 text-center sm:px-2">
                  <Mark yes={row.ours} />
                </td>
              </tr>
            ))}
            {g.ties.length > 0 ? (
              // What both do: one muted line, so the group does not read
              // thin and the ties are on the page beside the rows. From
              // `lg` every row is a little tighter (py-1.5, headings pt-2),
              // so the table, now taller by five lines, stays within about
              // 120px of the copy column beside it.
              <tr data-tie="" className="hero-reveal bg-white/[0.03] text-white/55" style={reveal()}>
                <th scope="row" className="px-4 py-2 lg:py-1.5 text-left text-[12px] font-normal leading-snug">
                  {/* " · " and not a comma: some names have commas of
                      their own ("create, update, delete"). */}
                  <span className="font-medium text-white/70">Both:</span> {g.ties.join(" · ")}
                </th>
                <td className="px-1 py-2 lg:py-1.5 text-center sm:px-2">
                  <Mark yes />
                </td>
                <td className="px-1 py-2 lg:py-1.5 text-center sm:px-2">
                  <Mark yes />
                </td>
              </tr>
            ) : null}
          </tbody>
        ))}
      </table>

      {/* A block of text, not a flex row: wrapped over two lines, a flex
          row parks the arrow at the far edge, away from the words it ends. */}
      <a
        className="mt-3 block text-center text-xs text-white/60 transition-colors hover:text-white lg:text-left"
        href="#comparison"
      >
        Built-in column: Anthropic&rsquo;s help page as of {checkedOn}. &ldquo;{NOT_DESCRIBED}&rdquo; means the page
        does not mention it, not that Claude cannot do it. See the full table{" "}
        <span aria-hidden="true">&rarr;</span>
      </a>
    </div>
  );
}
