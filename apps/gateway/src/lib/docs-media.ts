import fs from "node:fs";
import path from "node:path";

/**
 * What a docs page's rendered markdown needs done to its images and videos
 * before it is served, so they stop costing a reader who has not reached
 * them.
 *
 * Images: markdown gives `<img src alt>` and nothing else. Each one gets its
 * real `width` and `height`, read from the file under `public/`, so the page
 * reserves its space before the file arrives, plus `loading="lazy"` and
 * `decoding="async"`, so a screenshot far down the page is not downloaded
 * until the reader is near it. The page's first picture stays eager when it
 * is near the top, where it may be the largest thing in the first screen.
 *
 * Videos: a YouTube `<iframe>` loads the player, several hundred kilobytes
 * of script, on every view of the page, played or not. It becomes a link to
 * the video drawn as its poster with a play button. `DocsVideos`
 * (`app/docs/videos.tsx`) swaps the link for the same player when it is
 * clicked; with no script it is still a link that opens the video.
 */

export interface DocMediaOptions {
  /** Where local `src` paths resolve. Defaults to the app's `public/`. */
  publicDir?: string;
}

/** How much text may come before a page's first picture for it to count as
 * near the top. About two short paragraphs. */
export const NEAR_TOP_CHARS = 600;

/** Where a video's poster lives, by video id. A video without a file here is
 * drawn as a plain dark panel: no request to a third party before a click. */
export const POSTER_DIR = "/docs/video-posters";

export interface ImageSize {
  width: number;
  height: number;
}

/** Width and height from the first bytes of a PNG, GIF, JPEG or WebP file;
 * null for anything else, or for a file cut short. */
export function imageSize(data: Buffer): ImageSize | null {
  // PNG: signature, then the IHDR chunk with both as 32-bit big-endian.
  if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && data.toString("latin1", 12, 16) === "IHDR") {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  // GIF: both as 16-bit little-endian after the six-byte signature.
  if (data.length >= 10 && data.toString("latin1", 0, 3) === "GIF") {
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  // WebP: a RIFF container; the size sits differently in each of its kinds.
  if (data.length >= 30 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") {
    const kind = data.toString("latin1", 12, 16);
    if (kind === "VP8X") return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") {
      const bits = data.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    return null;
  }
  // JPEG: walk the segments to the start-of-frame marker.
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let at = 2;
    while (at + 9 < data.length) {
      if (data[at] !== 0xff) return null;
      const marker = data[at + 1];
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { width: data.readUInt16BE(at + 7), height: data.readUInt16BE(at + 5) };
      at += 2 + data.readUInt16BE(at + 2);
    }
  }
  return null;
}

/** The size of the local image a `src` names, or null when it is not a file
 * under `publicDir` or not a format read here. */
function localImageSize(src: string, publicDir: string): ImageSize | null {
  if (!src.startsWith("/") || src.startsWith("//")) return null;
  try {
    const file = path.join(publicDir, decodeURIComponent(src.split(/[?#]/)[0]));
    if (!file.startsWith(publicDir + path.sep)) return null;
    return imageSize(fs.readFileSync(file));
  } catch {
    return null;
  }
}

const attribute = (tag: string, name: string): string | null =>
  tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1] ?? null;

const hasAttribute = (tag: string, name: string): boolean => new RegExp(`\\s${name}(=|\\s|/?>)`, "i").test(tag);

/** The characters of text, tags and whitespace runs aside, in `html`. */
const textLength = (html: string): number => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").length;

const escapeHtml = (text: string): string =>
  text.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function sizedImage(tag: string, eager: boolean, publicDir: string): string {
  const added: string[] = [];
  const src = attribute(tag, "src");
  if (src && !hasAttribute(tag, "width") && !hasAttribute(tag, "height")) {
    const size = localImageSize(src, publicDir);
    if (size) added.push(`width="${size.width}"`, `height="${size.height}"`);
  }
  if (!eager && !hasAttribute(tag, "loading")) added.push('loading="lazy"');
  if (!hasAttribute(tag, "decoding")) added.push('decoding="async"');
  if (added.length === 0) return tag;
  return tag.replace(/\s*\/?>$/, ` ${added.join(" ")}>`);
}

const YOUTUBE_EMBED = /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{6,20})(?:\?[^"]*)?$/;

/** The play button's mark. Decorative: the words beside it are the label. */
const PLAY_MARK =
  '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>';

function videoFacade(tag: string, eager: boolean, publicDir: string): string | null {
  const src = attribute(tag, "src");
  const match = src?.match(YOUTUBE_EMBED);
  if (!src || !match) return null;
  const host = match[1] ? "www.youtube-nocookie.com" : "www.youtube.com";
  const id = match[2];
  const title = attribute(tag, "title") ?? "Video";
  const allow = attribute(tag, "allow") ?? "";

  const posterSrc = `${POSTER_DIR}/${id}.jpg`;
  const posterSize = localImageSize(posterSrc, publicDir);
  const poster = posterSize
    ? `<img src="${posterSrc}" alt="" width="${posterSize.width}" height="${posterSize.height}"${eager ? "" : ' loading="lazy"'} decoding="async" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;margin:0;border:0;border-radius:0">`
    : "";

  return (
    `<a class="docs-video" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener"` +
    ` data-video-embed="https://${host}/embed/${id}?autoplay=1" data-video-title="${escapeHtml(title)}"` +
    (allow ? ` data-video-allow="${escapeHtml(allow)}"` : "") +
    ' style="position:relative;display:block;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:12px;background:#0f172a;text-decoration:none">' +
    poster +
    '<span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:8px;max-width:90%;padding:10px 18px;border-radius:9999px;background:rgba(15,23,42,0.85);color:#fff;font-size:0.875rem;font-weight:600;line-height:1.3">' +
    PLAY_MARK +
    `<span>Play video: ${escapeHtml(title)}</span>` +
    "</span></a>"
  );
}

const MEDIA = /<img\b[^>]*>|<iframe\b[^>]*>\s*<\/iframe>/gi;

/** Rewrite the images and video embeds in a docs page's HTML. See the note
 * at the top of the file. Anything it does not recognise is left as it is. */
export function enhanceDocMedia(html: string, options: DocMediaOptions = {}): string {
  const publicDir = options.publicDir ?? path.join(process.cwd(), "public");
  let first = true;
  return html.replace(MEDIA, (tag: string, offset: number) => {
    // Only the page's first picture can stay eager, and only near the top.
    const eager = first && textLength(html.slice(0, offset)) <= NEAR_TOP_CHARS;
    if (/^<iframe/i.test(tag)) {
      const facade = videoFacade(tag, eager, publicDir);
      if (facade) first = false;
      return facade ?? (hasAttribute(tag, "loading") ? tag : tag.replace(/^<iframe/i, '<iframe loading="lazy"'));
    }
    first = false;
    return sizedImage(tag, eager, publicDir);
  });
}
