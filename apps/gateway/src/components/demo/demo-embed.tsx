/** One scripted demo window on its own, for a surface that is not the demo
 * grid: today, a blog post that carries a `<!-- demo:<id> -->` marker (see
 * `lib/demo-embed.ts`).
 *
 * THE DISCLOSURE COMES WITH IT. The window replays an authored script over
 * sample data, and any surface showing one without saying so presents a
 * recording as a live session. `DemoBento` renders the sentence
 * unconditionally for the grid; this is the same rule for a window shown
 * alone, so the caption is part of the component and a caller cannot leave
 * it off. `demo-embed.render.test.tsx` looks for it in the output.
 *
 * No composer link and no stagger: a post is read top to bottom, the window
 * should start when it scrolls into view, and the post has its own call to
 * action below.
 */

import { DEMO_DISCLOSURE } from "./demo-bento";
import { DEMO_WINDOWS } from "./demo-layout";
import { DemoWindow } from "./demo-section";

/** The script ids a post may name. */
export const EMBEDDABLE_DEMO_IDS: readonly string[] = Object.keys(DEMO_WINDOWS);

export function DemoEmbed({ id }: { id: string }) {
  if (!DEMO_WINDOWS[id]) return null;
  return (
    <figure className="my-8">
      <DemoWindow id={id} startDelayMs={0} />
      <figcaption className="mt-3 text-center text-sm text-muted-foreground">
        {DEMO_DISCLOSURE}
      </figcaption>
    </figure>
  );
}
