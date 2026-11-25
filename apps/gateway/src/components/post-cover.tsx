import { ZoomableImage } from "@/components/zoomable-image";
import { CoverAnimation } from "@/components/cover-animation";
import { CoverVideo } from "@/components/cover-video";
import { coverAnimationPath } from "@/lib/cover-animation";
import { coverVideoSources } from "@/lib/cover-video";
import { readSitePng } from "@/lib/post-card-image";

/** How wide the cover is drawn: the article column on a wide screen, the
 * screen on a narrow one. Lets the browser pick a file of that width and
 * not the widest one made. */
export const COVER_SIZES = "(min-width: 768px) 720px, 100vw";

/**
 * A post's cover, at the top of its page: the cover image, and over it the
 * post's animation when it has one, an animated SVG (`coverAnimation`) or a
 * looping video (`coverVideo`) (SCRUM-509). The image sizes the
 * box and is the animation's still, so a post with no `coverVideo` renders
 * exactly the image it always did, and an animation that does not show leaves it.
 *
 * It is the largest thing in a post's first screen, so it loads first
 * (`priority`), at the width it is drawn (`COVER_SIZES`), in a box of the
 * picture's own shape, read from the file, so nothing moves when it arrives.
 *
 * The text alternative is on the image: `coverAlt` when the post gives one,
 * else its title.
 */
export function PostCover({
  post,
}: {
  post: { title: string; coverImage?: string; coverVideo?: string; coverAnimation?: string; coverAlt?: string };
}) {
  if (!post.coverImage) return null;
  // One or the other. A post may not set both (a content test holds that);
  // if one did, the animation is what shows.
  const animation = coverAnimationPath(post.coverAnimation);
  const video = animation ? null : coverVideoSources(post.coverVideo);
  const size = readSitePng(post.coverImage) ?? { width: 1200, height: 630 };
  return (
    <div className="relative mt-8 overflow-hidden rounded-2xl border border-border">
      <ZoomableImage
        src={post.coverImage}
        alt={post.coverAlt ?? post.title}
        width={size.width}
        height={size.height}
        sizes={COVER_SIZES}
        className="h-auto w-full"
        priority
      />
      {animation && <CoverAnimation src={animation} />}
      {video && <CoverVideo sources={video} />}
    </div>
  );
}
