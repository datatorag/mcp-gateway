/**
 * A post's looping cover animation (SCRUM-509): the `coverVideo` frontmatter
 * field is a site path with no extension, and two files sit at it, an MP4
 * (H.264) and a WebM (VP9):
 *
 *   coverVideo: "/blog/my-post-cover"
 *     -> public/blog/my-post-cover.mp4
 *     -> public/blog/my-post-cover.webm
 *
 * The post's `coverImage` is the animation's still: what shows before the
 * video plays, when it cannot play, and to a visitor who asked for reduced
 * motion. So a post with a `coverVideo` must have a `coverImage`.
 * `blog-cover-video.test.ts` holds both rules for every post.
 *
 * No imports, so the page and the tests read one definition.
 */
export interface CoverVideoSources {
  webm: string;
  mp4: string;
}

/** The shape of the field: under /blog/, lowercase words, no extension. */
const COVER_VIDEO_PATH = /^\/blog\/[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

/** The two files for a `coverVideo` value, or null when the value is not a
 * path of that shape (an extension left on, a path outside /blog/). */
export function coverVideoSources(coverVideo: string | undefined): CoverVideoSources | null {
  if (!coverVideo || !COVER_VIDEO_PATH.test(coverVideo)) return null;
  return { webm: `${coverVideo}.webm`, mp4: `${coverVideo}.mp4` };
}
