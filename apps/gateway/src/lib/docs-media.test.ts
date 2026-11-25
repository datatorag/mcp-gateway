import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NEAR_TOP_CHARS, POSTER_DIR, enhanceDocMedia, imageSize } from "./docs-media";
import { getAllDocs } from "./docs";

/** The first bytes of a PNG of the given size: signature and IHDR. */
function png(width: number, height: number): Buffer {
  const data = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data, 0);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "latin1");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

/** A JPEG's opening: an APP0 segment, then a baseline frame header. */
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const frame = Buffer.alloc(12);
  frame.writeUInt16BE(0xffc0, 0);
  frame.writeUInt16BE(10, 2);
  frame[4] = 8;
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame]);
}

let publicDir: string;

beforeAll(() => {
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-media-"));
  fs.mkdirSync(path.join(publicDir, "docs", "video-posters"), { recursive: true });
  fs.writeFileSync(path.join(publicDir, "docs", "wide.png"), png(1200, 630));
  fs.writeFileSync(path.join(publicDir, "docs", "tall.png"), png(400, 900));
  fs.writeFileSync(path.join(publicDir, "docs", "photo.jpg"), jpeg(960, 540));
  fs.writeFileSync(path.join(publicDir, "docs", "notes.txt"), "not an image");
  fs.writeFileSync(path.join(publicDir, "docs", "video-posters", "abcDEF12345.jpg"), jpeg(960, 540));
});

afterAll(() => {
  fs.rmSync(publicDir, { recursive: true, force: true });
});

const run = (html: string) => enhanceDocMedia(html, { publicDir });
const filler = (chars: number) => `<p>${"word ".repeat(Math.ceil(chars / 5))}</p>`;

describe("imageSize", () => {
  it("reads a PNG, a JPEG and a GIF", () => {
    expect(imageSize(png(1200, 630))).toEqual({ width: 1200, height: 630 });
    expect(imageSize(jpeg(960, 540))).toEqual({ width: 960, height: 540 });
    const gif = Buffer.alloc(10);
    gif.write("GIF89a", 0, "latin1");
    gif.writeUInt16LE(320, 6);
    gif.writeUInt16LE(200, 8);
    expect(imageSize(gif)).toEqual({ width: 320, height: 200 });
  });

  it("reads a WebP in its extended form", () => {
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "latin1");
    webp.write("WEBP", 8, "latin1");
    webp.write("VP8X", 12, "latin1");
    webp.writeUIntLE(799, 24, 3);
    webp.writeUIntLE(599, 27, 3);
    expect(imageSize(webp)).toEqual({ width: 800, height: 600 });
  });

  it("answers null for a file it cannot read as an image", () => {
    expect(imageSize(Buffer.from("not an image"))).toBeNull();
    expect(imageSize(Buffer.alloc(0))).toBeNull();
    expect(imageSize(png(10, 10).subarray(0, 20))).toBeNull();
  });
});

describe("images in a docs page", () => {
  it("gives an image far down the page its size, lazy loading and async decoding", () => {
    const html = run(`${filler(NEAR_TOP_CHARS + 50)}<p><img src="/docs/wide.png" alt="A wide one"></p>`);
    expect(html).toContain('<img src="/docs/wide.png" alt="A wide one" width="1200" height="630" loading="lazy" decoding="async">');
  });

  it("leaves the first image eager when it is near the top, and only that one", () => {
    const html = run(`<p>Short intro.</p><img src="/docs/wide.png" alt="one"><img src="/docs/tall.png" alt="two">`);
    expect(html).toContain('<img src="/docs/wide.png" alt="one" width="1200" height="630" decoding="async">');
    expect(html).toContain('<img src="/docs/tall.png" alt="two" width="400" height="900" loading="lazy" decoding="async">');
  });

  it("counts text, not markup, when deciding what is near the top", () => {
    const markup = `<p><a href="${"x".repeat(NEAR_TOP_CHARS * 2)}">link</a></p>`;
    expect(run(`${markup}<img src="/docs/wide.png" alt="">`)).not.toContain("lazy");
  });

  it("reads a JPEG, and a self-closed tag", () => {
    const html = run(`${filler(NEAR_TOP_CHARS + 50)}<img src="/docs/photo.jpg" alt="p" />`);
    expect(html).toContain('<img src="/docs/photo.jpg" alt="p" width="960" height="540" loading="lazy" decoding="async">');
  });

  it("still lazy-loads an image whose size it cannot read, and adds no size", () => {
    const later = filler(NEAR_TOP_CHARS + 50);
    for (const src of ["/docs/missing.png", "/docs/notes.txt", "https://example.com/a.png", "//example.com/a.png", "/../secret.png"]) {
      const html = run(`${later}<img src="${src}" alt="x">`);
      expect(html, src).toContain(`<img src="${src}" alt="x" loading="lazy" decoding="async">`);
    }
  });

  it("keeps what an author wrote by hand", () => {
    const html = run(`${filler(NEAR_TOP_CHARS + 50)}<img src="/docs/wide.png" alt="x" width="300" loading="eager">`);
    expect(html).toContain('<img src="/docs/wide.png" alt="x" width="300" loading="eager" decoding="async">');
  });

  it("does not take a word inside a value for an attribute", () => {
    const html = run(`${filler(NEAR_TOP_CHARS + 50)}<img src="/docs/wide.png" alt="The page at phone width, loading slowly">`);
    expect(html).toContain('alt="The page at phone width, loading slowly" width="1200" height="630" loading="lazy" decoding="async">');
  });

  it("makes every image wait on a page that has its own picture above the body", () => {
    const html = enhanceDocMedia(`<p>Short intro.</p><img src="/docs/wide.png" alt="one"><img src="/docs/tall.png" alt="two">`, { publicDir, eagerFirst: false });
    expect(html.match(/loading="lazy"/g)).toHaveLength(2);
  });

  it("leaves a page with no media untouched", () => {
    const html = "<h2>Title</h2><p>Text with <code>&lt;img&gt;</code> in it.</p>";
    expect(run(html)).toBe(html);
  });
});

describe("an image address that cannot be read", () => {
  it("is left without a size, not thrown on", () => {
    for (const src of ["/docs/bad%zz.png", "/../outside.png", "/%2e%2e/outside.png"]) {
      const out = run(`<p><img src="${src}" alt="x"></p>`);
      expect(out, src).not.toMatch(/\swidth=/);
    }
  });
});

describe("a video embed in a docs page", () => {
  const iframe = (id: string, host = "www.youtube.com") =>
    `<iframe src="https://${host}/embed/${id}" title="Setup &amp; walkthrough" style="width:100%;aspect-ratio:16/9;" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;

  it("becomes a link to the video, drawn as its poster, that carries what the player needs", () => {
    const html = run(`<p>Intro.</p>${iframe("abcDEF12345")}`);
    expect(html).not.toContain("<iframe");
    expect(html).toContain('href="https://www.youtube.com/watch?v=abcDEF12345"');
    expect(html).toContain('data-video-embed="https://www.youtube.com/embed/abcDEF12345?autoplay=1"');
    expect(html).toContain('data-video-title="Setup &amp; walkthrough"');
    expect(html).toContain('data-video-allow="autoplay; encrypted-media"');
    // A text label, not an icon alone.
    expect(html).toContain("<span>Play video: Setup &amp; walkthrough</span>");
    // Near the top, so the poster is not lazy; it has its size either way.
    expect(html).toMatch(new RegExp(`<img src="${POSTER_DIR}/abcDEF12345.jpg" alt="" width="960" height="540" decoding="async"`));
  });

  it("lazy-loads the poster of a video far down the page", () => {
    const html = run(`${filler(NEAR_TOP_CHARS + 50)}${iframe("abcDEF12345")}`);
    expect(html).toMatch(/video-posters\/abcDEF12345\.jpg" alt="" width="960" height="540" loading="lazy"/);
  });

  it("keeps the privacy host for the player when the embed used it", () => {
    const html = run(iframe("abcDEF12345", "www.youtube-nocookie.com"));
    expect(html).toContain('data-video-embed="https://www.youtube-nocookie.com/embed/abcDEF12345?autoplay=1"');
  });

  it("draws a video with no poster file as a plain panel, with no image request", () => {
    const html = run(iframe("zzzzzzzzzzz"));
    expect(html).toContain('data-video-embed="https://www.youtube.com/embed/zzzzzzzzzzz?autoplay=1"');
    expect(html).not.toContain("<img");
  });

  it("counts as the page's first picture, so an image after it is lazy", () => {
    const html = run(`${iframe("abcDEF12345")}<img src="/docs/wide.png" alt="x">`);
    expect(html).toContain('<img src="/docs/wide.png" alt="x" width="1200" height="630" loading="lazy" decoding="async">');
  });

  it("only lazy-loads a frame that is not a video it knows", () => {
    const other = '<iframe src="https://example.com/widget" title="Widget"></iframe>';
    expect(run(other)).toBe('<iframe loading="lazy" src="https://example.com/widget" title="Widget"></iframe>');
  });
});

describe("the docs pages as served", () => {
  const pages = getAllDocs();
  const images = pages.flatMap((page) =>
    [...page.html.matchAll(/<img\b[^>]*>/g)].map((m) => ({ slug: page.slug, tag: m[0] })),
  );

  it("has images to check", () => {
    expect(images.length).toBeGreaterThan(0);
  });

  it("gives every local image its real size and async decoding", () => {
    for (const { slug, tag } of images) {
      const src = tag.match(/src="([^"]+)"/)?.[1] ?? "";
      if (!src.startsWith("/")) continue;
      const size = imageSize(fs.readFileSync(path.join(process.cwd(), "public", src)));
      expect(size, `${slug}: ${src} is not a readable image under public/`).not.toBeNull();
      expect(tag, `${slug}: ${src}`).toContain(`width="${size!.width}" height="${size!.height}"`);
      expect(tag, `${slug}: ${src}`).toContain('decoding="async"');
    }
  });

  it("leaves at most one image eager per page", () => {
    for (const page of pages) {
      const eager = [...page.html.matchAll(/<img\b[^>]*>/g)].filter((m) => !m[0].includes('loading="lazy"'));
      expect(eager.length, page.slug).toBeLessThanOrEqual(1);
    }
  });

  it("serves no video player before a click, and every video has its poster", () => {
    for (const page of pages) {
      expect(page.html, page.slug).not.toMatch(/<iframe[^>]+youtube/);
      for (const [, id] of page.html.matchAll(/data-video-embed="https:\/\/[^/]+\/embed\/([^?"]+)/g)) {
        expect(fs.existsSync(path.join(process.cwd(), "public", POSTER_DIR, `${id}.jpg`)), `${page.slug}: ${id}`).toBe(true);
      }
    }
  });
});
