/** The scripted-demo section: five windows replaying authored sessions through
 * the real playground presentation components, each paired with the gap it
 * closes. Entirely client-side — no MCP calls, no API routes, no LLM.
 *
 * The heading is the caller's, the DISCLOSURE IS NOT (it is a caption under
 * every window, rendered here). The windows replay
 * scripts against sample data, so any surface showing them without saying so
 * is presenting a recording as a live session. It used to live in the home
 * page's subhead with a comment in demo-section warning that it had to travel
 * with the windows; the second surface arrived and the comment was the only
 * thing standing between us and shipping without it. Rendering it here makes
 * that structural instead of remembered.
 *
 * FULL-WIDTH ROWS THAT ALTERNATE SIDES (Manuel, 2026-08-07; four then, five
 * since the Jira row), replacing a
 * bento of two wide rows over a 2-up bottom row. The two demos in that bottom
 * row rendered at half width, which is where the tool cards got cramped, so
 * ending it is the point rather than a side effect.
 *
 * Order is sheets, slides, gmail, jira, accounts, and the last one is
 * deliberate: two accounts in one turn is the only claim here that rests on no
 * subtlety at all, which makes it the right closer. The Jira row sits beside
 * Gmail because it is the same kind of beat, a write you approve, and it
 * starts from an email. The problem/solution pairs are deliberately
 * unparallel: only sourced limitations are named, each names the connector
 * that has the limit rather than "Claude" in general, and a row with no such
 * limit to name (Gmail) names none.
 */

import Link from "next/link";
import { CircleCheckIcon, CircleMinusIcon } from "lucide-react";
import { DemoWindow } from "./demo-section";
import {
  DEMO_CTA_ACTION,
  DEMO_CTA_ALTERNATIVE,
  DEMO_CTA_SUPPORT,
} from "./demo-copy";
import { CtaLink } from "@/components/cta-link";

/** ONE WORD CHANGED FROM THE ORIGINAL, AND ONLY ONE: "playground UI" became
 * "Agent UI", because the surface it named was renamed. Everything else is
 * untouched on purpose. The sentence is what stops a scripted replay reading
 * as a live session, and it lives here rather than in a caller's subhead
 * because a comment asking callers to carry it was, once, the only thing
 * standing between us and shipping without it. Do not shorten it, and do not
 * let a rename become a rewrite.
 *
 * WHERE IT RENDERS changed once, on request (Manuel, 2026-10-09, SCRUM-400):
 * from a paragraph under the heading to a caption under each window, which is
 * where a blog post's embedded window already carried it. The words did not
 * change and neither did the rule: this component renders it, for every
 * window, with no prop that turns it off. */
export const DEMO_DISCLOSURE =
  "A scripted replay with sample data. This is the real Agent UI, approval gate included.";

/**
 * One list, in render order, because the order IS the argument: the two edits
 * to a file you already have come first, then sending, then moving a file
 * between two services, then the two accounts.
 *
 * It used to be two arrays with two different cell shapes. Merging them is
 * what the alternating layout requires, and it also removes a trap: the split
 * meant the visual order was a consequence of which array a cell sat in, so
 * moving a cell between positions could silently change its typography.
 */
/**
 * How much weight a tile carries, which is the thing that keeps this a BENTO
 * rather than a zigzag of identical bands (Manuel, 2026-08-07: "make sure
 * we're following a bento style layout").
 *
 * A bento's defining property is varied cell emphasis, and the previous shape
 * got that from two different cell sizes. Alternation needs one list in render
 * order, so the variation moves here instead: same tile width for every row, but
 * the two edit-an-existing-file beats are set larger and roomier than the rows
 * that follow them. Emphasis is stored per cell rather than derived from
 * position, because it belongs to the claim: sheets is the lead beat wherever
 * it sits in the list.
 *
 * Width is deliberately NOT a lever here. Varying it would mean putting two
 * tiles on one row again, and half-width is exactly where the tool cards were
 * cramped.
 */
type Weight = "lead" | "supporting";

export const CELLS: {
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
    // NOT A COMPARISON, on purpose. This line used to say Claude writes the
    // email and stops at the draft. The built-in Gmail connector has sent,
    // replied and forwarded since August 2026, and the comparison table
    // further down this same page concedes all three, so the row contradicted
    // the page it sits on. It now says what the reader wants and what we do,
    // and nothing about anyone else. Before a problem line names a limit in
    // someone else's product, find the row in that table that agrees with it.
    id: "gmail",
    weight: "supporting",
    problem: "You wanted the email sent, not a draft left for you to finish.",
    solution: "DataToRAG sends it from the account you name, once you approve.",
  },
  {
    // The connector is named as its vendor names it. It covers Jira and
    // Confluence, and the limit is in its Jira half: no tool takes a file.
    // Read from the connector's own tool list on 2026-10-09. A claim about
    // someone else's product goes stale on their schedule, so re-read the
    // list before this line is reused anywhere.
    id: "jira",
    weight: "supporting",
    problem: "Claude's Atlassian connector cannot attach a file to a Jira issue.",
    solution:
      "DataToRAG puts the email and its PDF on the issue, once you approve.",
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
  /** Optional lines under the heading.
   *
   * NEVER INSTEAD OF THE DISCLOSURE. The disclosure is rendered
   * unconditionally under every window whatever goes here, so adding section
   * copy can never displace it, which is the failure this component was
   * restructured to make impossible. Optional because a caller may want the
   * windows without the pitch. */
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
        <h2 className="text-balance font-display text-2xl font-bold text-foreground sm:text-3xl">
          {heading}
        </h2>
        {standfirst?.map((line) => (
          // `text-balance` evens the lines out, so a narrow column cannot
          // leave "and ask." alone on the second one.
          <p
            className="mx-auto mt-3 max-w-xl text-balance text-base text-muted-foreground sm:text-lg"
            key={line}
          >
            {line}
          </p>
        ))}
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
                {/* Unconditional, one per window. See DEMO_DISCLOSURE. */}
                <p
                  className="mt-2.5 text-balance text-center text-xs text-muted-foreground"
                  data-demo-disclosure=""
                >
                  {DEMO_DISCLOSURE}
                </p>
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
          <CtaLink
            href={ctaHref}
            className="font-display text-base font-bold text-foreground underline underline-offset-4 transition-colors hover:text-primary"
          >
            {DEMO_CTA_ACTION}
          </CtaLink>
          <p className="mt-2 text-sm text-muted-foreground">{DEMO_CTA_SUPPORT}</p>
          <p className="mx-auto mt-4 max-w-md text-balance text-sm text-muted-foreground">
            {DEMO_CTA_ALTERNATIVE}
          </p>
        </div>
      )}
    </>
  );
}
