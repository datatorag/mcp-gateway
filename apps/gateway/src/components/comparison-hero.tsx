"use client";

/** The landing page's hero shot (SCRUM-425): the comparison table, played a
 * group at a time.
 *
 * The rows are `heroGroups()` from connector-comparison.tsx, passed in from
 * the page, so nothing here is a claim of its own: a row flipped in the full
 * table leaves this on the same deploy. Each group's rows appear one at a
 * time, the built-in cell resolving to the miss mark and ours to the check,
 * then the group rests and the next one plays.
 *
 * Motion is bounded the way the demo windows' is: it pauses while the table is
 * hovered, while anything in it has focus, and while it is scrolled out of
 * view, and under prefers-reduced-motion the first group is shown complete and
 * nothing cycles. The dots under the table are buttons, in the tab order, and
 * the arrow keys move between them, so a keyboard reader steps the groups
 * instead of waiting for them.
 *
 * The server render is the first group complete, so the hero is never empty
 * before hydration and a reader without script sees real rows.
 */

import { useEffect, useRef, useState } from "react";
import { CircleCheckIcon, CircleMinusIcon } from "lucide-react";
import type { HeroGroup } from "./connector-comparison";

/** Between one row appearing and the next. */
export const ROW_EVERY_MS = 450;
/** From a row appearing to its two marks resolving. */
export const RESOLVE_MS = 300;
/** How long a group rests complete before the next one plays. With at most
 * four rows this makes a group about six seconds. */
export const GROUP_REST_MS = 4200;

function Mark({ yes, resolved }: { yes: boolean; resolved: boolean }) {
  if (!resolved) {
    return <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-white/30" />;
  }
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
  const [index, setIndex] = useState(0);
  // Rows of the current group that have appeared. Starts complete, so the
  // server render and the first paint show the whole first group.
  const [shown, setShown] = useState(groups[0]?.rows.length ?? 0);
  // Whether the newest row's marks have resolved.
  const [settled, setSettled] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const paused = hovered || focused || !visible || reducedMotion || groups.length < 2;
  const group = groups[index];
  const total = group?.rows.length ?? 0;

  // The clock: resolve the newest row, then show the next, then rest, then
  // move to the next group with no rows shown.
  useEffect(() => {
    if (paused || !group) return;
    let t: ReturnType<typeof setTimeout>;
    if (!settled) {
      t = setTimeout(() => setSettled(true), RESOLVE_MS);
    } else if (shown < total) {
      t = setTimeout(() => {
        setShown((n) => n + 1);
        setSettled(false);
      }, ROW_EVERY_MS);
    } else {
      t = setTimeout(() => {
        setIndex((i) => (i + 1) % groups.length);
        setShown(0);
        setSettled(true);
      }, GROUP_REST_MS);
    }
    return () => clearTimeout(t);
  }, [paused, group, settled, shown, total, groups.length]);

  if (!group) return null;

  // A step chosen by hand shows its group complete; there is nothing to wait for.
  const select = (i: number) => {
    setIndex(i);
    setShown(groups[i].rows.length);
    setSettled(true);
  };

  const onDotKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = (i + step + groups.length) % groups.length;
    select(next);
    dotsRef.current[next]?.focus();
  };

  const showsSlides = groups.some((g) => g.slides);

  return (
    <div
      ref={rootRef}
      className="w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {/* Every group's table is laid out, in one grid cell, so the box is
          always as tall as the tallest group and the line under it never
          moves. Padding to a row count did not hold: rows wrap to different
          heights, and the box still changed by 60px across a loop. Only the
          current table is visible or read; a row not yet played keeps its
          space and stays invisible. The glass is on this box, and each table
          sits at its own height at the top of it: stretched to the cell, a
          short group's rows grew tall to fill it. */}
      <div className="grid overflow-hidden rounded-xl border border-white/15 bg-white/5 backdrop-blur-sm">
        {groups.map((g, gi) => {
          const current = gi === index;
          return (
            <table
              key={g.label}
              aria-hidden={current ? undefined : true}
              className={`w-full self-start text-left text-sm [grid-area:1/1] ${
                current ? "" : "invisible"
              }`}
            >
              {current ? (
                <caption className="sr-only">
                  What DataToRAG does that Claude&rsquo;s built-in connectors do not: {g.label}
                </caption>
              ) : null}
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/50">
                  <th scope="col" className="px-4 py-2.5 text-left font-display text-sm font-bold normal-case tracking-normal text-white">
                    {g.label}
                  </th>
                  <th scope="col" className="w-20 px-1 py-2.5 text-center font-medium sm:w-24 sm:px-2">
                    Built-in
                  </th>
                  <th scope="col" className="w-20 px-1 py-2.5 text-center font-medium text-blue-200 sm:w-24 sm:px-2">
                    DataToRAG
                  </th>
                </tr>
              </thead>
              <tbody className="text-white/80">
                {g.rows.map((row, i) => {
                  const played = !current || i < shown;
                  const resolved = !current || i < shown - 1 || settled;
                  return (
                    <tr
                      // A new key when a row is played remounts it, so its
                      // entrance runs each time and not only on first mount.
                      key={`${row.capability}-${played ? "on" : "off"}`}
                      aria-hidden={played ? undefined : true}
                      className={`border-b border-white/10 last:border-b-0 ${
                        !played ? "invisible" : current ? "animate-fade-in-up" : ""
                      }`}
                    >
                      <th scope="row" className={`px-4 py-2.5 text-left ${row.emphasis ? "font-semibold text-white" : "font-normal"}`}>
                        {row.tag ? (
                          <span className="mr-2 text-[11px] font-medium uppercase tracking-wider text-white/45">{row.tag}</span>
                        ) : null}
                        {row.capability}
                      </th>
                      <td className="px-1 py-2.5 text-center sm:px-2">
                        <Mark yes={row.builtIn} resolved={resolved} />
                      </td>
                      <td className="px-1 py-2.5 text-center sm:px-2">
                        <Mark yes={row.ours} resolved={resolved} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        })}
      </div>

      {groups.length > 1 ? (
        <div className="mt-3 flex justify-center gap-2 lg:justify-start" role="group" aria-label="Comparison groups">
          {groups.map((g, i) => (
            <button
              key={g.label}
              ref={(el) => {
                dotsRef.current[i] = el;
              }}
              type="button"
              aria-label={`Show ${g.label}`}
              aria-pressed={i === index}
              tabIndex={i === index ? 0 : -1}
              onClick={() => select(i)}
              onKeyDown={(e) => onDotKey(e, i)}
              className={`size-2.5 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                i === index ? "bg-white/80" : "bg-white/25 hover:bg-white/50"
              }`}
            />
          ))}
        </div>
      ) : null}

      {/* A block of text, not a flex row: wrapped over two lines, a flex
          row parks the arrow at the far edge, away from the words it ends. */}
      <a
        className="mt-3 block text-center text-sm text-white/70 transition-colors hover:text-white lg:text-left"
        href="#comparison"
      >
        Checked by hand on {verifiedOn}
        {showsSlides ? `, Google Slides on ${slidesVerifiedOn}` : ""}. See every capability we tested{" "}
        <span aria-hidden="true">&rarr;</span>
      </a>
    </div>
  );
}
