import { db } from "@/lib/db";
import { BUILT_IN_GROUP_KEY, loadAllTools } from "@/lib/all-tools";
import { allToolsMarkdown, markdownResponse, unavailableResponse } from "@/lib/markdown-copies";

/** `/docs/tools.md`: the all-tools page as Markdown. Reached through the
 * rewrite in `next.config.ts`. Request-time, like the page: the list is read
 * from the registry.
 *
 * A list that could not be read, or came back with no connector tool in it,
 * is answered 503 and never as a page with nothing under its headings: whoever
 * reads this is a program, and an empty list reads as "there are no tools". */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const groups = await loadAllTools(db);
    // The built-ins come from the code, so they alone prove no read.
    if (!groups.some((g) => g.key !== BUILT_IN_GROUP_KEY && g.tools.length > 0)) throw new Error("the registry answered no tools");
    return markdownResponse(allToolsMarkdown(groups));
  } catch (err) {
    console.warn("[docs/tools.md] tool list read failed", err instanceof Error ? err.message : err);
    return unavailableResponse("The tool list could not be read just now. Try again in a minute.");
  }
}
