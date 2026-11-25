import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getAllPosts } from "./blog";
import { coverVideoSources } from "./cover-video";

const PUBLIC = join(import.meta.dirname, "../../public");
const onDisk = (sitePath: string) => existsSync(join(PUBLIC, sitePath));

/** What is wrong with a post's `coverVideo`, in words; empty when nothing is. */
function problems(
  post: { coverImage?: string; coverVideo?: string },
  exists: (sitePath: string) => boolean = onDisk
): string[] {
  if (post.coverVideo === undefined) return [];
  const sources = coverVideoSources(post.coverVideo);
  if (!sources) return [`coverVideo "${post.coverVideo}" is not a /blog/ path with no extension`];
  return [
    ...(post.coverImage ? [] : ["coverVideo needs a coverImage as its still"]),
    ...[sources.mp4, sources.webm].filter((f) => !exists(f)).map((f) => `missing file public${f}`),
  ];
}

describe("coverVideoSources", () => {
  it("names the two files at a path with no extension", () => {
    expect(coverVideoSources("/blog/my-post-cover")).toEqual({
      webm: "/blog/my-post-cover.webm",
      mp4: "/blog/my-post-cover.mp4",
    });
    expect(coverVideoSources("/blog/covers/my-post")).toEqual({
      webm: "/blog/covers/my-post.webm",
      mp4: "/blog/covers/my-post.mp4",
    });
  });

  it("is null for no value, an extension left on, a path outside /blog/, and a path that climbs", () => {
    for (const bad of [undefined, "", "/blog/my-post-cover.mp4", "/videos/x", "blog/x", "/blog/../x", "//blog/x", "/blog/X"]) {
      expect(coverVideoSources(bad), String(bad)).toBeNull();
    }
  });
});

describe("every post's cover video", () => {
  const posts = getAllPosts();

  it("finds the posts it is about to judge", () => {
    expect(posts.length).toBeGreaterThan(10);
  });

  it.each(posts.filter((p) => p.coverVideo !== undefined).map((p) => [p.slug, p] as const))(
    "%s: both files are in public/, and it has a cover image for its still",
    (_slug, post) => {
      expect(problems(post)).toEqual([]);
    }
  );

  it("the check can fail: a missing file, a missing still, and a bad path are each named", () => {
    const none = () => false;
    const onlyMp4 = (f: string) => f.endsWith(".mp4");
    expect(problems({ coverImage: "/blog/a.png", coverVideo: "/blog/a-cover" }, none)).toEqual([
      "missing file public/blog/a-cover.mp4",
      "missing file public/blog/a-cover.webm",
    ]);
    expect(problems({ coverImage: "/blog/a.png", coverVideo: "/blog/a-cover" }, onlyMp4)).toEqual([
      "missing file public/blog/a-cover.webm",
    ]);
    expect(problems({ coverVideo: "/blog/a-cover" }, () => true)).toEqual(["coverVideo needs a coverImage as its still"]);
    expect(problems({ coverImage: "/blog/a.png", coverVideo: "/blog/a-cover.mp4" }, () => true)).toEqual([
      'coverVideo "/blog/a-cover.mp4" is not a /blog/ path with no extension',
    ]);
    expect(problems({ coverImage: "/blog/a.png" }, none)).toEqual([]);
  });
});
