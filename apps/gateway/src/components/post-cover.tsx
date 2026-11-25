import { ZoomableImage } from "@/components/zoomable-image";
import { CoverVideo } from "@/components/cover-video";
import { coverVideoSources } from "@/lib/cover-video";

/**
 * A post's cover, at the top of its page: the cover image, and over it the
 * post's looping animation when it has one (SCRUM-509). The image sizes the
 * box and is the animation's still, so a post with no `coverVideo` renders
 * exactly the image it always did, and a video that does not play leaves it.
 *
 * The text alternative is on the image: `coverAlt` when the post gives one,
 * else its title.
 */
export function PostCover({
  post,
}: {
  post: { title: string; coverImage?: string; coverVideo?: string; coverAlt?: string };
}) {
  if (!post.coverImage) return null;
  const video = coverVideoSources(post.coverVideo);
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
      {video && <CoverVideo sources={video} />}
    </div>
  );
}
