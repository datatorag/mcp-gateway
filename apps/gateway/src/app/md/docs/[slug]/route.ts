import { getAllDocs, getDocBySlug } from "@/lib/docs";
import { docMarkdown, markdownResponse, notFoundResponse } from "@/lib/markdown-copies";

/** `/docs/<slug>.md`: one docs page as Markdown, from the record its HTML
 * page renders. Reached through the rewrite in `next.config.ts`. Built once
 * per page, at build, like the page. */
export const dynamic = "force-static";

export function generateStaticParams() {
  return getAllDocs().map((d) => ({ slug: d.slug }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await ctx.params;
  const doc = getDocBySlug(slug);
  return doc ? markdownResponse(docMarkdown(doc)) : notFoundResponse();
}
