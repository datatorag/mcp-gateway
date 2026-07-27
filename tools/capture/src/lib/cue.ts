import type React from "react";
import { interpolate, spring } from "remotion";

/**
 * A cue frame far enough in the past that every spring and interpolation has
 * fully settled. Stills are rendered by handing animated components this cue,
 * so ONE component set serves both video (cue at a real frame) and images
 * (cue at SETTLED) — no separate "static" variants to drift out of sync.
 */
export const SETTLED = -400;

/** 0→1 progress for an animation that starts at `cue`. At cue=SETTLED this is
 * 1 on every frame, which is what makes stills work. */
export function cueProgress({
  frame,
  fps,
  cue,
  durationInFrames = 20,
}: {
  frame: number;
  fps: number;
  cue: number;
  durationInFrames?: number;
}): number {
  return spring({
    frame: frame - cue,
    fps,
    durationInFrames,
    config: { damping: 200 },
  });
}

/** Fade/slide-in helper driven by cueProgress; y in px. */
export function enterStyle(progress: number, y = 12): React.CSSProperties {
  return {
    opacity: progress,
    transform: `translateY(${interpolate(progress, [0, 1], [y, 0])}px)`,
  };
}
