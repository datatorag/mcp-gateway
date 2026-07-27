/**
 * Sizing is PER FORMAT, always. A padding or zoom value tuned for 1200x628
 * overflows 960x1200; changing one number globally breaks another format.
 * Every shot reads its dimensions, zoom, and padding from here, keyed by the
 * format it is rendering, and never hardcodes a unit that must differ.
 */
export type CaptureFormat = "landscape" | "square" | "portrait";

export interface FormatSpec {
  width: number;
  height: number;
  /** CSS zoom applied to the authored-narrow content container. */
  zoom: number;
  /** Outer padding around the content, px, pre-zoom. */
  pad: number;
}

export const FORMATS: Record<CaptureFormat, FormatSpec> = {
  landscape: { width: 1200, height: 628, zoom: 2.2, pad: 24 },
  square: { width: 1080, height: 1080, zoom: 2.0, pad: 32 },
  portrait: { width: 960, height: 1200, zoom: 1.8, pad: 32 },
};

/**
 * The width shots are authored at. Author NARROW and scale up as a unit with
 * CSS `zoom` — not a scale() transform. `zoom` participates in layout, so the
 * container sizes itself to the zoomed content; transform-scale leaves the
 * layout at the unscaled size and everything overlaps. Authoring narrow is
 * what keeps the product's text-xs legible in the output; capturing at
 * natural width produces unreadable strips.
 */
export const AUTHOR_WIDTH = 430;
