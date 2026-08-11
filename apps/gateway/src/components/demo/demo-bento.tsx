/** The scripted-demo section: four windows replaying authored sessions through
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
 * FOUR FULL-WIDTH ROWS THAT ALTERNATE SIDES (Manuel, 2026-08-07), replacing a
 * bento of two wide rows over a 2-up bottom row. The two demos in that bottom
 * row rendered at half width, which is where the tool cards got cramped, so
 * ending it is the point rather than a side effect.
 *
 * Order is sheets, slides, gmail, accounts, and the last one is deliberate:
 * two accounts in one turn is the only claim here that rests on no subtlety at
 * all, which makes it the right closer. The problem/solution pairs are
 * deliberately unparallel — only sourced limitations are named, and each names
 * the connector that has the limit rather than "Claude" in general.
 */

import Link from "next/link";
import { CircleCheckIcon, CircleMinusIcon } from "lucide-react";
import { DemoWindow } from "./demo-section";
import { DEMO_CTA_ACTION, DEMO_CTA_SUPPORT } from "./demo-copy";

/** ONE WORD CHANGED FROM THE ORIGINAL, AND ONLY ONE: "playground UI" became
 * "Agent UI", because the surface it named was renamed. Everything else is
 * untouched on purpose. The sentence is what stops a scripted replay reading
 * as a live session, and it lives here rather than in a caller's subhead
 * because a comment asking callers to carry it was, once, the only thing
 * standing between us and shipping without it. Do not move it, do not shorten
 * it, and do not let a rename become a rewrite. */
export const DEMO_DISCLOSURE =
  "A scripted replay with sample data. This is the real Agent UI, approval gate included.";

/**
 * One list, in render order, because the order IS the argument: the two edits
 * to a file you already have come first, then sending, then the two accounts.
 *
 * It used to be two arrays with two different cell shapes. Merging them is
 * what the alternating layout requires, and it also removes a trap: the split
 * meant the visual order was a consequence of which array a cell sat in, so
 * moving a cell between positions could silently change its typography.
 */
/**
 * How much weight a tile carries, which is the thing that keeps this a BENTO
 * rather than a zigzag of four identical bands (Manuel, 2026-08-07: "make sure
 * we're following a bento style layout").
 *
 * A bento's defining property is varied cell emphasis, and the previous shape
 * got that from two different cell sizes. Alternation needs one list in render
 * order, so the variation moves here instead: same tile width for all four, but
 * the two edit-an-existing-file beats are set larger and roomier than the two
 * that follow them. Emphasis is stored per cell rather than derived from
 * position, because it belongs to the claim: sheets is the lead beat wherever
 * it sits in the list.
 *
 * Width is deliberately NOT a lever here. Varying it would mean putting two
 * tiles on one row again, and half-width is exactly where the tool cards were
 * cramped.
 */
type Weight = "lead" | "supporting";

const CELLS: {
  id: string;
  weight: Weight;
  problem: string;
  solution: string;
}[] = [
  {
    id: "sheets",
    weight: "lead",
    problem:
      "Claude reads the sheet you already keep, then hands you rows to paste in yourself.",
    solution:
      "DataToRAG changes the rows in that same file, after asking you first.",
  },
  {
    id: "slides",
    weight: "lead",
    problem:
      "Claude's Drive connector can make you a deck, but it arrives empty. One slide, and the title is yours to type.",
    solution:
      "DataToRAG writes into the deck you already have, after asking you first.",
  },
  {
    id: "gmail",
    weight: "supporting",
    problem: "Claude writes the email and stops at the draft.",
    solution: "DataToRAG sends it from your account, once you approve.",
  },
  {
    id: "accounts",
    weight: "supporting",
    problem:
      "Claude's Gmail connector is signed in to one account, so the other inbox isn't there to search.",
    solution:
      "DataToRAG searches your work and personal accounts in the same turn.",
  },
];

/** The two weights, as whole looks rather than scattered ternaries, so a tile
 * cannot end up with a lead heading and supporting padding. */
const WEIGHTS: Record<
  Weight,
  { pad: string; problem: string; solution: string; icon: string; iconTop: string }
> = {
  lead: {
    pad: "p-5 sm:p-7",
    problem: "text-base leading-relaxed sm:text-lg",
    solution: "font-display text-xl font-semibold leading-snug sm:text-2xl",
    icon: "size-5",
    iconTop: "mt-1",
  },
  supporting: {
    pad: "p-5 sm:p-6",
    problem: "text-sm leading-relaxed sm:text-base",
    solution: "font-display text-lg font-semibold leading-snug sm:text-xl",
    icon: "size-4 sm:size-5",
    iconTop: "mt-0.5 sm:mt-1",
  },
};

export function DemoBento({
  heading,
  standfirst,
  promptHref,
  promptLabel,
  ctaHref,
}: {
  heading: string;
  /** Optional lines between the heading and the disclosure.
   *
   * ABOVE THE DISCLOSURE, NEVER INSTEAD OF IT. The disclosure is rendered
   * unconditionally below whatever goes here, so adding section copy can never
   * displace it — which is the failure this component was restructured to make
   * impossible. Optional because the lead page wants the windows without the
   * home page's pitch. */
  standfirst?: string[];
  /** Composer-shaped link target. Omit both and the windows render with no
   * composer at all — the lead page does exactly that, because a second route
   * into the agent competes with the form that page exists to collect. */
  promptHref?: string;
  promptLabel?: string;
  /** Target for the closing call to action. Omit it and no CTA renders. */
  ctaHref?: string;
}) {
  return (
    <>
      <div className="animate-fade-in-up text-center">
        <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
          {heading}
        </h2>
        {standfirst?.map((line) => (
          <p
            className="mx-auto mt-3 max-w-xl text-base text-muted-foreground"
            key={line}
          >
            {line}
          </p>
        ))}
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          {DEMO_DISCLOSURE}
        </p>
      </div>

      <div
        className="animate-fade-in-up mt-10 grid gap-4"
        style={{ animationDelay: "0.1s" }}
      >
        {/* The text is the argument, the window is the evidence: the
            solution line is the largest type in each cell, the problem
            line stays visibly quieter. Neither outranks the section
            heading. */}
        {CELLS.map((cell, i) => {
          // Derived from position, not stored on the cell. A hand-maintained
          // flag would let the sequence and the alternation disagree the first
          // time someone reorders the list.
          const reversed = i % 2 === 1;
          const w = WEIGHTS[cell.weight];
          return (
            <div
              className={`min-w-0 rounded-2xl border border-border bg-secondary/50 lg:flex lg:items-start lg:gap-8 ${w.pad} ${
                // `flex-row-reverse` rather than a grid column swap, ON PURPOSE.
                // The text stays FIRST in the DOM for every row, so the stacked
                // phone layout is always text then window. Reordering in the
                // markup would put the evidence before the claim on the rows
                // that alternate, which reads backwards on the surface where
                // alternation does nothing anyway.
                reversed ? "lg:flex-row-reverse" : ""
              }`}
              key={cell.id}
            >
              <div className="min-w-0 lg:w-5/12 lg:pt-2">
                {/* Same visual grammar as the hero comparison table:
                    muted minus for the gap, primary check for the fix. */}
                <p
                  className={`flex items-start gap-2.5 text-muted-foreground ${w.problem}`}
                >
                  <CircleMinusIcon
                    aria-hidden="true"
                    className={`shrink-0 text-muted-foreground/60 ${w.icon} ${w.iconTop}`}
                  />
                  <span>{cell.problem}</span>
                </p>
                <p
                  className={`mt-3 flex items-start gap-2.5 text-foreground ${w.solution}`}
                >
                  <CircleCheckIcon
                    aria-hidden="true"
                    className={`shrink-0 text-primary ${w.icon} ${w.iconTop}`}
                  />
                  <span>{cell.solution}</span>
                </p>
              </div>
              <div className="mt-5 min-w-0 lg:mt-0 lg:w-7/12">
                <DemoWindow
                  id={cell.id}
                  promptHref={promptHref}
                  promptLabel={promptLabel}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* The closing call to action, rendered here rather than by each caller
          so both surfaces get the same words and the same shape. It was
          briefly duplicated in the home page, which is how two surfaces
          showing "the same" section start disagreeing about it. Opt-in: a
          caller that wants the windows without a route out of the page passes
          no href and gets nothing. */}
      {ctaHref && (
        <div className="mt-8 text-center">
          <Link
            href={ctaHref}
            className="font-display text-base font-bold text-foreground underline underline-offset-4 transition-colors hover:text-primary"
          >
            {DEMO_CTA_ACTION}
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">{DEMO_CTA_SUPPORT}</p>
        </div>
      )}
    </>
  );
}
