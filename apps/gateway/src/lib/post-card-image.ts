import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Which picture a blog post offers a link preview (SCRUM-367).
 *
 * A preview crops whatever it is given to about 1.91:1. A cover drawn for the
 * top of an article is often a tall screenshot or a 3:2 diagram, and cropped
 * to that shape it shows an arbitrary band of itself. So a cover is used only
 * when it is already card-shaped: close to 1.91:1, under a megabyte, and a
 * file whose size can be read, so the width and height are declared and the
 * crawler need not guess. Anything else returns undefined and the caller
 * falls back to the site-wide card.
 *
 * `ogImage` in frontmatter is an author saying "use this one", and wins
 * without the shape test. Its size is declared when it can be read.
 */

export interface CardImage {
  url: string;
  width?: number;
  height?: number;
}

const SITE = "https://datatorag.com";
const TARGET_RATIO = 1.91;
/** How far from 1.91:1 a cover may be and still crop cleanly: 2:1 is inside,
 * 16:10 and squarer are outside. */
export const RATIO_TOLERANCE = 0.1;
export const MAX_CARD_BYTES = 1024 * 1024;

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

/** Width, height and byte size of a PNG under public/, or null when the path
 * is not a site path, leaves public/, is missing, or is not a PNG. */
export function readSitePng(sitePath: string): { width: number; height: number; bytes: number } | null {
  if (!sitePath.startsWith("/") || sitePath.startsWith("//")) return null;
  const file = path.resolve(PUBLIC_DIR, "." + sitePath);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return null;
  try {
    const head = readFileSync(file).subarray(0, 24);
    if (head.length < 24 || head.subarray(1, 4).toString("latin1") !== "PNG") return null;
    // IHDR: width and height are the big-endian uint32s at bytes 16 and 20.
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20), bytes: statSync(file).size };
  } catch {
    return null;
  }
}

export function isCardShaped(size: { width: number; height: number; bytes: number }): boolean {
  if (size.width <= 0 || size.height <= 0) return false;
  const ratio = size.width / size.height;
  return Math.abs(ratio - TARGET_RATIO) / TARGET_RATIO <= RATIO_TOLERANCE && size.bytes < MAX_CARD_BYTES;
}

const cache = new Map<string, CardImage | undefined>();

export function postCardImage(post: { ogImage?: string; coverImage?: string }): CardImage | undefined {
  const key = `${post.ogImage ?? ""}\n${post.coverImage ?? ""}`;
  if (cache.has(key)) return cache.get(key);
  const result = resolve(post);
  cache.set(key, result);
  return result;
}

function resolve(post: { ogImage?: string; coverImage?: string }): CardImage | undefined {
  if (post.ogImage) {
    const size = readSitePng(post.ogImage);
    return {
      url: new URL(post.ogImage, SITE).toString(),
      ...(size ? { width: size.width, height: size.height } : {}),
    };
  }
  if (!post.coverImage) return undefined;
  const size = readSitePng(post.coverImage);
  if (!size || !isCardShaped(size)) return undefined;
  return { url: SITE + post.coverImage, width: size.width, height: size.height };
}
