/**
 * Sizing is PER FORMAT, always. A padding or zoom value tuned for 1200x628
 * overflows 960x1200; changing one number globally breaks another format.
 * Every shot reads its dimensions, zoom, and padding from here, keyed by the
 * format it is rendering, and never hardcodes a unit that must differ.
 */
export type CaptureFormat = "landscape" | "square" | "portrait" | "docs";

export interface FormatSpec {
  width: number;
  height: number;
  /** CSS zoom applied to the authored-narrow content container. */
  zoom: number;
  /** Outer padding around the content, px, pre-zoom. */
  pad: number;
  /** Width the shot is authored at, before zoom. Social formats author at
   * phone width so the product's text-xs survives a thumbnail. Docs author
   * WIDER, because a docs reader is looking at a desktop app: at phone width
   * the tool cards' JSON runs past the card edge and the clipping reads as a
   * rendering fault rather than as the product. */
  authorWidth: number;
}

/**
 * The width shots are authored at. Author NARROW and scale up as a unit with
 * CSS `zoom`, not a scale() transform. `zoom` participates in layout, so the
 * container sizes itself to the zoomed content; transform-scale leaves the
 * layout at the unscaled size and everything overlaps. Authoring narrow is
 * what keeps the product's text-xs legible in the output; capturing at
 * natural width produces unreadable strips.
 */
export const AUTHOR_WIDTH = 430;

/** `zoom` multiplies `left`/`top` as well as the content, so a shot offset
 * by `pad` needs a canvas of zoom x (AUTHOR_WIDTH + 2 x pad) to sit inside
 * its own margins. Derived rather than typed in, because the two numbers
 * drifting apart clips the render on one side and reads as a layout bug. */
const DOCS_ZOOM = 1.5;
const DOCS_PAD = 32;
/** Desktop playground width, not phone width. See FormatSpec.authorWidth. */
const DOCS_AUTHOR_WIDTH = 720;
export const DOCS_CANVAS_WIDTH =
  DOCS_ZOOM * (DOCS_AUTHOR_WIDTH + 2 * DOCS_PAD);

export const FORMATS: Record<CaptureFormat, FormatSpec> = {
  landscape: { width: 1200, height: 628, zoom: 2.2, pad: 24, authorWidth: AUTHOR_WIDTH },
  square: { width: 1080, height: 1080, zoom: 2.0, pad: 32, authorWidth: AUTHOR_WIDTH },
  portrait: { width: 960, height: 1200, zoom: 1.8, pad: 32, authorWidth: AUTHOR_WIDTH },
  /* In-content docs imagery. Zoom is LOWER than the social formats on
     purpose: those are seen at thumbnail size and need the product's text-xs
     pushed up hard, while a docs image sits in the prose column at roughly
     its own size and should read as a screenshot rather than a poster. The
     height here is a placeholder, every docs still overrides it per script,
     because a transcript's height is a property of the script, not of the
     format (see DOCS_SHOTS in Root.tsx). */
  docs: {
    width: DOCS_CANVAS_WIDTH,
    height: 1000,
    zoom: DOCS_ZOOM,
    pad: DOCS_PAD,
    authorWidth: DOCS_AUTHOR_WIDTH,
  },
};
