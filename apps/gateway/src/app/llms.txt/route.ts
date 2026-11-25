import { llmsTxt } from "@/lib/markdown-copies";

/**
 * `/llms.txt`: the product in a paragraph and every docs page and use case
 * with its one-line description, each at its Markdown address
 * (`lib/markdown-copies.ts`). Built from the content files once, at build,
 * like the pages it lists.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(llmsTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
