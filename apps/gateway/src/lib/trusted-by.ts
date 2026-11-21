/**
 * The organizations named in the home page's "Trusted by" row, in the order
 * they are shown. This row is the only place the site names them.
 *
 * One entry per organization, so removing one is deleting its entry (and its
 * files under public/trusted-by). An organization that asks is removed.
 * Where each file came from is in public/trusted-by/SOURCES.md.
 */
export interface TrustedBy {
  /** The organization's name: the image's alt text, or the words set beside an icon. */
  name: string;
  /** File under /trusted-by. */
  file: string;
  /** A separate file for a dark ground, where the organization publishes one. Without it the mark is tinted white. */
  fileOnDark?: string;
  /** The file's own size, so the row holds its place before the image loads. */
  width: number;
  height: number;
  /** Height the mark is shown at, in pixels at full size. */
  shownAt: number;
  /** Empty space inside the file above and below the mark, in pixels at `shownAt`, taken back out of the row. */
  trim?: number;
  /** The file is an icon with no wordmark, so the name is set beside it in the site's font. */
  nameBeside?: boolean;
  /** The mark keeps its own colors on a dark ground (it carries its own light backing). */
  keepColors?: boolean;
}

export const TRUSTED_BY: readonly TrustedBy[] = [
  { name: "Indoff", file: "indoff.svg", fileOnDark: "indoff-white.svg", width: 116, height: 43, shownAt: 34 },
  { name: "Westwing", file: "westwing.svg", width: 1150.5, height: 345.5, shownAt: 70, trim: 22 },
  { name: "Factorial", file: "factorial-wordmark-s.png", width: 900, height: 277, shownAt: 58, trim: 12 },
  { name: "Four Point Advisory", file: "fourpoint-clear.png", width: 328, height: 327, shownAt: 40, nameBeside: true },
  { name: "Colegio de Bachilleres del Estado de Chihuahua", file: "cobach-s.png", width: 900, height: 309, shownAt: 66, trim: 8 },
  { name: "SMA BOPKRI 1 Yogyakarta", file: "smabosa.png", width: 179, height: 180, shownAt: 44, nameBeside: true, keepColors: true },
];
