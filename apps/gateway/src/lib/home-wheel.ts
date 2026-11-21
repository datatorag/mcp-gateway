import { PUBLIC_SERVICES, type PublicService } from "./public-integrations";

/**
 * The tools on the home page's wheel: the public services and nothing else,
 * each with its logo, its docs page, and one line on what an agent can do
 * there.
 *
 * Every line is a claim. Each verb in it is a tool the service has today; a
 * line is not the whole list, and it names nothing the service lacks. The
 * record is keyed by `PublicService`, so a new public service does not
 * compile until it has a line.
 */
const CAN_DO: Record<PublicService, string> = {
  Gmail: "Search, read, send, reply, and label",
  Calendar: "List, create, and update events",
  Drive: "Search, read, and organize files",
  Docs: "Read, write, and edit in place",
  Sheets: "Read, query, update, and format",
  Slides: "Read, create, and update decks",
  Contacts: "Search, create, and update",
  Tasks: "List, create, and complete",
  Jira: "Search, create, update, and comment",
  Confluence: "Search, read, and edit pages",
  Notion: "Search, read, and edit pages",
};

export interface WheelTool {
  label: PublicService;
  /** The service's full-color mark under public/icons/services. */
  src: string;
  /** Its docs page. */
  href: string;
  canDo: string;
}

export const WHEEL_TOOLS: readonly WheelTool[] = PUBLIC_SERVICES.map((label) => {
  const slug = label.toLowerCase();
  return { label, src: `/icons/services/${slug}.svg`, href: `/docs/${slug}`, canDo: CAN_DO[label] };
});
