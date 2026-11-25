import { getAllPosts, getPostBySlug } from "@/lib/blog";
import { markdownResponse, notFoundResponse, postMarkdown } from "@/lib/markdown-copies";

/** `/blog/<slug>.md`: one post as Markdown, from the record its HTML page
 * renders. Reached through the rewrite in `next.config.ts`. Built once per
 * post, at build, like the page. */
export const dynamic = "force-static";

export function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await ctx.params;
  const post = getPostBySlug(slug);
  return post ? markdownResponse(postMarkdown(post)) : notFoundResponse();
}
