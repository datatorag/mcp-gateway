import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getAllPosts } from "./blog";
import { MAX_COVER_ANIMATION_BYTES, coverAnimationPath, coverAnimationProblems } from "./cover-animation";

const PUBLIC = join(import.meta.dirname, "../../public");

/** What is wrong with a post's `coverAnimation`, in words; empty when nothing is. */
function problems(
  post: { coverImage?: string; coverVideo?: string; coverAnimation?: string },
  read: (sitePath: string) => { text: string; bytes: number } | null = (sitePath) => {
    const file = join(PUBLIC, sitePath);
    return existsSync(file) ? { text: readFileSync(file, "utf8"), bytes: statSync(file).size } : null;
  }
): string[] {
  if (post.coverAnimation === undefined) return [];
  const path = coverAnimationPath(post.coverAnimation);
  if (!path) return [`coverAnimation "${post.coverAnimation}" is not a /blog/ path ending in .svg`];
  const file = read(path);
  return [
    ...(post.coverImage ? [] : ["coverAnimation needs a coverImage as its still"]),
    ...(post.coverVideo === undefined ? [] : ["a post sets coverAnimation or coverVideo, not both"]),
    ...(file ? coverAnimationProblems(file.text, file.bytes).map((p) => `public${path} ${p}`) : [`missing file public${path}`]),
  ];
}

const GOOD = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1200 630">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#123"/></linearGradient></defs>
  <style>@keyframes spin { to { transform: rotate(360deg) } } .a { animation: spin 4s linear infinite; fill: url(#g) }
    @font-face { font-family: x; src: url(data:font/woff2;base64,AAAA) }</style>
  <rect class="a" width="100" height="100"/><use href="#g"/><use xlink:href="#g"/>
  <image href="data:image/png;base64,AAAA"/>
</svg>`;

describe("coverAnimationPath", () => {
  it("is the value for a lowercase /blog/ path ending in .svg", () => {
    expect(coverAnimationPath("/blog/my-post-cover.svg")).toBe("/blog/my-post-cover.svg");
    expect(coverAnimationPath("/blog/covers/my-post.svg")).toBe("/blog/covers/my-post.svg");
  });

  it("is null for no value, no extension, another extension, a path outside /blog/, a path that climbs, and another site", () => {
    for (const bad of [undefined, "", "/blog/a", "/blog/a.png", "/blog/a.svg?x=1", "/img/a.svg", "/blog/../a.svg", "//x.test/blog/a.svg", "https://x.test/blog/a.svg", "/blog/A.svg"]) {
      expect(coverAnimationPath(bad), String(bad)).toBeNull();
    }
  });
});

describe("what a cover animation's file may hold", () => {
  it("passes a self-contained file: CSS keyframes, same-file references, and data it carries", () => {
    expect(coverAnimationProblems(GOOD, GOOD.length)).toEqual([]);
  });

  it.each([
    ["a script", GOOD.replace("<rect", "<script>alert(1)</script><rect"), "has a <script"],
    ["an event attribute", GOOD.replace("<rect", '<rect onload="x()"'), "has an on*= event attribute"],
    ["an event attribute with no space before it", GOOD.replace('height="100"/>', 'height="100"onclick="x()"/>'), "has an on*= event attribute"],
    ["a foreignObject", GOOD.replace("<rect", "<foreignObject><div/></foreignObject><rect"), "has a <foreignObject"],
    ["a link out", GOOD.replace('<use href="#g"/>', '<a href="https://x.test/">x</a>'), "has an href outside the file: https://x.test/"],
    ["an xlink out", GOOD.replace('xlink:href="#g"', 'xlink:href="/blog/other.svg#g"'), "has an href outside the file: /blog/other.svg#g"],
    ["a script URL", GOOD.replace('<use href="#g"/>', "<a href='javascript:x()'>x</a>"), "has an href outside the file: javascript:x()"],
    ["a font from elsewhere", GOOD.replace("url(data:font/woff2;base64,AAAA)", "url(https://x.test/f.woff2)"), "has a url( outside the file: https://x.test/f.woff2"],
    ["a quoted image from the site", GOOD.replace("fill: url(#g)", 'background: url("/blog/a.png")'), "has a url( outside the file: /blog/a.png"],
    ["an imported stylesheet", GOOD.replace("<style>", "<style>@import 'x.css';"), "has an @import"],
    // Ways to hide one of the above from a match on the text.
    [
      "a script under a prefix, in another namespace",
      GOOD.replace("<rect", '<x:script xmlns:x="http://www.w3.org/1999/xhtml">alert(1)</x:script><rect'),
      "has a prefixed element",
    ],
    [
      "a namespace that is not SVG or xlink",
      GOOD.replace("<rect", '<g xmlns:x="http://www.w3.org/1999/xhtml"/><rect'),
      "declares a namespace that is not SVG or xlink: http://www.w3.org/1999/xhtml",
    ],
    ["a DOCTYPE", `<!DOCTYPE svg [<!ENTITY x "&#60;script&#62;">]>${GOOD}`, "has a DOCTYPE"],
    ["an entity that expands into markup", `<!DOCTYPE svg [<!ENTITY x "&#60;script&#62;">]>${GOOD}`, "has an entity declaration"],
    ["an external script or frame source", GOOD.replace("<rect", '<rect src="https://x.test/x.js"'), "has a src= attribute"],
    [
      "an animation that writes a link",
      GOOD.replace("<rect", '<a><set attributeName="href" to="https://x.test/"/></a><rect'),
      "animates a link or an event handler",
    ],
    [
      "an animation that writes a handler",
      GOOD.replace("<rect", '<set attributeName="onclick" to="x()"/><rect'),
      "animates a link or an event handler",
    ],
    ["an escaped at-rule", GOOD.replace("<style>", '<style>@\\69mport "https://x.test/x.css";'), "has a backslash"],
    [
      "a script under a prefix that is not ASCII",
      GOOD.replace("<rect", '<\u00e9:script xmlns:\u00e9="http://www.w3.org/1999/xhtml">alert(1)</\u00e9:script><rect'),
      "has a prefixed element",
    ],
    [
      "a prefix other than xlink, even for an allowed namespace",
      GOOD.replace("<rect", '<g xmlns:s="http://www.w3.org/2000/svg"/><rect'),
      "declares a prefix other than xlink: s",
    ],
    ["an at-rule spelled with a character reference", GOOD.replace("<style>", '<style>&#64;import "https://x.test/x.css";'), "has a character reference (&#)"],
    [
      "a stylesheet instruction carrying its sheet as data",
      `<?xml-stylesheet href="data:text/css;base64,AAAA"?>${GOOD}`,
      "has an xml-stylesheet",
    ],
    [
      "data that is not an image or a font",
      GOOD.replace('<use href="#g"/>', '<use href="data:text/html;base64,AAAA"/>'),
      "has an href outside the file: data:text/html;base64,AAAA",
    ],
    ["an image-set", GOOD.replace("fill: url(#g)", 'background: image-set("https://x.test/a.png" 1x)'), "has an image-set("],
  ])("names %s", (_what, svg, problem) => {
    expect(coverAnimationProblems(svg, svg.length)).toContain(problem);
  });

  it("names a file at or over the size limit, and a file that is not an SVG", () => {
    expect(coverAnimationProblems(GOOD, MAX_COVER_ANIMATION_BYTES - 1)).toEqual([]);
    expect(coverAnimationProblems(GOOD, MAX_COVER_ANIMATION_BYTES)).toEqual([
      `is ${MAX_COVER_ANIMATION_BYTES} bytes; the limit is ${MAX_COVER_ANIMATION_BYTES}`,
    ]);
    expect(MAX_COVER_ANIMATION_BYTES).toBe(300 * 1024);
    expect(coverAnimationProblems("<html></html>", 13)).toEqual(["is not an SVG"]);
  });
});

describe("every post's cover animation", () => {
  const posts = getAllPosts();

  it("finds the posts it is about to judge", () => {
    expect(posts.length).toBeGreaterThan(10);
  });

  it.each(posts.filter((p) => p.coverAnimation !== undefined).map((p) => [p.slug, p] as const))(
    "%s: the file is in public/, is small and self-contained, and the post has a still and no video",
    (_slug, post) => {
      expect(problems(post)).toEqual([]);
    }
  );

  it("the check can fail: a missing file, a missing still, both fields, a bad path, and a bad file are each named", () => {
    const good = () => ({ text: GOOD, bytes: GOOD.length });
    const base = { coverImage: "/blog/a.png", coverAnimation: "/blog/a-cover.svg" };
    expect(problems(base, good)).toEqual([]);
    expect(problems(base, () => null)).toEqual(["missing file public/blog/a-cover.svg"]);
    expect(problems({ coverAnimation: "/blog/a-cover.svg" }, good)).toEqual(["coverAnimation needs a coverImage as its still"]);
    expect(problems({ ...base, coverVideo: "/blog/a-cover" }, good)).toEqual(["a post sets coverAnimation or coverVideo, not both"]);
    expect(problems({ ...base, coverAnimation: "/blog/a-cover" }, good)).toEqual([
      'coverAnimation "/blog/a-cover" is not a /blog/ path ending in .svg',
    ]);
    expect(problems(base, () => ({ text: GOOD.replace("<rect", "<script/><rect"), bytes: 10 }))).toEqual([
      "public/blog/a-cover.svg has a <script",
    ]);
    expect(problems({ coverImage: "/blog/a.png" }, () => null)).toEqual([]);
  });
});
