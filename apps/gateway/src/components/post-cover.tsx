import { ZoomableImage } from "@/components/zoomable-image";
import { CoverAnimation } from "@/components/cover-animation";
import { CoverVideo } from "@/components/cover-video";
import { coverAnimationPath } from "@/lib/cover-animation";
import { coverVideoSources } from "@/lib/cover-video";

/**
 * A post's cover, at the top of its page: the cover image, and over it the
 * post's animation when it has one, an animated SVG (`coverAnimation`) or a
 * looping video (`coverVideo`) (SCRUM-509). The image sizes the
 * box and is the animation's still, so a post with no `coverVideo` renders
 * exactly the image it always did, and an animation that does not show leaves it.
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
  return (
    <div className="relative mt-8 overflow-hidden rounded-2xl border border-border">
      <ZoomableImage
        src={post.coverImage}
        alt={post.coverAlt ?? post.title}
        width={1200}
        height={630}
        className="w-full"
        priority
      />
      {animation && <CoverAnimation src={animation} />}
      {video && <CoverVideo sources={video} />}
    </div>
  );
}
