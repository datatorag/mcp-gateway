import { docsIndexMarkdown, markdownResponse } from "@/lib/markdown-copies";

/** `/docs.md`: the docs index as Markdown. Reached through the rewrite in
 * `next.config.ts`. */
export const dynamic = "force-static";

export function GET(): Response {
  return markdownResponse(docsIndexMarkdown());
}
