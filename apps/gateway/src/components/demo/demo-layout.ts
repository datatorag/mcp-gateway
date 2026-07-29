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
 */

export interface DemoWindowLayout {
  /** Matches DemoScript.id. */
  id: string;
  /** Short service name shown in the window header. */
  service: string;
  /** Fixed height of the playback frame (transcript area, header excluded). */
  frame: string;
  /** Delay before this window's first live run. Staggered so the three
   * approval gates land at different moments instead of in lockstep; each
   * window shows its completed end state until its turn. */
  startDelayMs: number;
}

export const DEMO_WINDOWS: Record<string, DemoWindowLayout> = {
  sheets: {
    id: "sheets",
    service: "Sheets",
    frame: "h-[556px] sm:h-[396px] lg:h-[412px]",
    startDelayMs: 0,
  },
  gmail: {
    id: "gmail",
    service: "Gmail",
    frame: "h-[380px] sm:h-[292px] lg:h-[308px]",
    startDelayMs: 7000,
  },
  jira: {
    id: "jira",
    service: "Jira",
    frame: "h-[392px] sm:h-[304px] lg:h-[336px]",
    startDelayMs: 14000,
  },
};
