/** Shared layout contract for the demo bento grid: the server-rendered
 * window shells (demo-section) and the lazy playback chunk (scripted-demo)
 * both read from here, so the reserved space and the loaded content can
 * never disagree and cause layout shift.
 *
 * Frame heights are measured, not chosen: each window's height is the peak
 * content height its own script reaches (the approval beat, ConfirmCard
 * open, args fully rendered), per width tier — base covers stacked phone
 * widths, `sm` the wide single-column band, `lg` the bento columns.
 * Re-measure if a script's copy or args change.
 *
 * Measured at the width where each tier's frame is narrowest and its text
 * therefore wraps tallest: 390 for base (phone), 640 for `sm`, 1024 for `lg`,
 * plus 8px of slack. A tier that is a few pixels short only ever scrolls —
 * the transcript keeps the newest beat in view — so the slack is for wrap
 * differences across fonts, not for correctness. Some windows measure the
 * same at `sm` and `lg`: their peak state is short enough that the extra
 * column width changes no line breaks.
 */

export interface DemoWindowLayout {
  /** Matches DemoScript.id. */
  id: string;
  /** Short service name shown in the window header. */
  service: string;
  /** Fixed height of the playback frame (transcript area, header excluded). */
  frame: string;
  /** Delay before this window's first live run. Staggered so the four
   * approval gates land at different moments instead of in lockstep; each
   * window shows its completed end state until its turn. */
  startDelayMs: number;
}

export const DEMO_WINDOWS: Record<string, DemoWindowLayout> = {
  sheets: {
    id: "sheets",
    service: "Sheets",
    frame: "h-[522px] sm:h-[410px] lg:h-[410px]",
    startDelayMs: 0,
  },
  slides: {
    id: "slides",
    service: "Slides",
    frame: "h-[522px] sm:h-[378px] lg:h-[378px]",
    startDelayMs: 5_000,
  },
  gmail: {
    id: "gmail",
    service: "Gmail",
    frame: "h-[380px] sm:h-[292px] lg:h-[308px]",
    startDelayMs: 10_000,
  },
  accounts: {
    id: "accounts",
    service: "Gmail · two accounts",
    frame: "h-[328px] sm:h-[248px] lg:h-[248px]",
    startDelayMs: 15_000,
  },
};
