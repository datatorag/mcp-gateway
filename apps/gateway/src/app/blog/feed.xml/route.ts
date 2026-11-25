import { BLOG_FEED_TYPE } from "../copy";
import { blogFeedXml } from "@/lib/blog-feed";

/** `/blog/feed.xml`: every post as an RSS 2.0 feed, newest first
 * (`lib/blog-feed.ts`). Built from the content files once, at build, like
 * the posts it lists. */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(blogFeedXml(), { headers: { "Content-Type": `${BLOG_FEED_TYPE}; charset=utf-8` } });
}
