import { markdownResponse, notFoundResponse, useCaseMarkdown } from "@/lib/markdown-copies";
import { getAllUseCases, getUseCaseBySlug } from "@/lib/use-cases";

/** `/use-cases/<slug>.md`: one use case as Markdown, from the record its
 * page is drawn from. Reached through the rewrite in `next.config.ts`. */
export const dynamic = "force-static";

export function generateStaticParams() {
  return getAllUseCases().map((u) => ({ slug: u.slug }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await ctx.params;
  const useCase = getUseCaseBySlug(slug);
  return useCase ? markdownResponse(useCaseMarkdown(useCase)) : notFoundResponse();
}
