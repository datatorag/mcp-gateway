/** The landing page's hero shot (SCRUM-425, SCRUM-426): every gap between
 * Claude's built-in connectors and us, at once.
 *
 * The rows are `heroGroups()` from connector-comparison.tsx, passed in from
 * the page, so nothing here is a claim of its own: a row flipped in the full
 * table leaves this on the same deploy.
 *
 * All of it is on the page from the first paint. It used to play one group
 * at a time, which meant a visitor never saw more than four of the nine gaps,
 * and the gaps are the point. What is left of the motion is one short reveal
 * on load: each row fades in, staggered over about a second, and then nothing
 * moves. The reveal is a CSS class (`hero-reveal` in globals.css) that only
 * exists under prefers-reduced-motion: no-preference, so a reader who asked
 * for less motion gets the finished table and no script decides it. A server
 * component: there is no state left to hold.
 */

import { CircleCheckIcon, CircleMinusIcon } from "lucide-react";
import type { HeroGroup } from "./connector-comparison";

/** Delay of the first row's reveal, and the step between rows. Twenty lines
 * (five group headings, ten gap rows, five tie lines) start within a second
 * and finish by about 1.3s. */
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

export function ComparisonHero({
  groups,
  verifiedOn,
  slidesVerifiedOn,
}: {
  groups: HeroGroup[];
  verifiedOn: string;
  slidesVerifiedOn: string;
}) {
  const showsSlides = groups.some((g) => g.slides);
  let line = 0;
  const reveal = () => ({ animationDelay: `${(REVEAL_START_S + REVEAL_STEP_S * line++).toFixed(2)}s` });

  return (
    <div className="w-full">
      <table className="w-full overflow-hidden rounded-xl border border-white/15 bg-white/5 text-left text-sm backdrop-blur-sm">
        <caption className="sr-only">What DataToRAG does that Claude&rsquo;s built-in connectors do not</caption>
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
                  {row.tag ? (
                    <span className="mr-2 text-[10px] font-medium uppercase tracking-wider text-white/45">{row.tag}</span>
                  ) : null}
                  {row.capability}
                </th>
                <td className="px-1 py-2 lg:py-1.5 text-center sm:px-2">
                  <Mark yes={row.builtIn} />
                </td>
                <td className="px-1 py-2 lg:py-1.5 text-center sm:px-2">
                  <Mark yes={row.ours} />
                </td>
              </tr>
            ))}
            {g.ties.length > 0 ? (
              // What both connectors do (SCRUM-427): one muted line, so the
              // gaps stay the point and the group does not read thin. From
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
        Checked by hand on {verifiedOn}
        {showsSlides ? `, Google Slides on ${slidesVerifiedOn}` : ""}. See every capability we tested{" "}
        <span aria-hidden="true">&rarr;</span>
      </a>
    </div>
  );
}
