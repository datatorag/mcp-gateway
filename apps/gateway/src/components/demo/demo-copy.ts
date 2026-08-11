/**
 * The demo section's frame copy: heading, standfirst, closing call to action.
 *
 * THE FRAME, NEVER THE ROWS. The four demo rows are claim-checked against a
 * first-hand tool-surface audit, their problem/solution pairs are deliberately
 * unparallel, and each names the specific connector that has the limit rather
 * than "Claude" in general. Rewriting one is a different job needing that
 * audit, not this file. Rows live in `demo-bento.tsx` and stay there.
 *
 * The disclosure is NOT here either. It is owned by `demo-bento.tsx` and
 * rendered unconditionally, because a caller that could forget it once did.
 *
 * In a module rather than inline in the page so the claim below can be
 * asserted rather than remembered (see demo-copy.test.ts).
 */

import { FREE_MONTHLY_AGENT_RUNS } from "@/gateway/billing/plans";

export const DEMO_HEADING = "Watch the agent do the work.";

/** Two lines, above the disclosure.
 *
 * Line one answers the objection that the funnel actually dies on, which is
 * the config file, not the product. Line two says out loud that the
 * bring-your-own-client path is not being retired, because a page that hides
 * it reads as a downgrade to the people most likely to pay for it. "Same tools
 * either way" is the load-bearing half, and it is true: both surfaces resolve
 * the same per-user tool set. */
export const DEMO_STANDFIRST = [
  "No install, no config file, nothing to paste. Connect your Google account and ask.",
  "Prefer to work in Claude or ChatGPT? Take the config and go. Same tools either way.",
];

/** The closing call to action.
 *
 * NAMES THE NUMBER ON PURPOSE. The allowance is small enough that discovering
 * it at the moment of refusal would read as a trap; a limit you were told
 * about is a product, a limit you find is a bait and switch. Saying it also
 * does some qualifying for us.
 *
 * IT MUST NOT OFFER BRING-YOUR-OWN-KEY. That exit is deferred, so at launch
 * the cap has exactly two: upgrade, or move to your own client. Copy that
 * promises a third ships before the exit does. */
export const DEMO_CTA_ACTION = "Try it on your own files.";
export const DEMO_CTA_SUPPORT =
  "Free, and the first twenty-five runs a month are on us.";

/** The spelled-out number in {@link DEMO_CTA_SUPPORT}, mapped so a test can
 * compare prose against the enforced cap.
 *
 * The CTA spells the number in words because that is how the sentence reads,
 * which means it cannot interpolate the constant and would otherwise be a
 * hand-copied figure on the highest-traffic page we own. Counts drift, and a
 * marketing page promising an allowance the code does not grant is the exact
 * shape of claim that has cost us before. Only the values we might plausibly
 * ship need to be here; an unmapped cap fails the test loudly rather than
 * passing quietly. */
export const NUMBER_WORDS: Record<number, string> = {
  10: "ten",
  20: "twenty",
  25: "twenty-five",
  50: "fifty",
  100: "one hundred",
};

/** What the CTA must say about the allowance, derived from the enforced cap
 * rather than from memory. */
export function expectedRunWord(): string | undefined {
  return NUMBER_WORDS[FREE_MONTHLY_AGENT_RUNS];
}
