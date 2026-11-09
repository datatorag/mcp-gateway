import { SHAPES, type Suggestion } from "@/gateway/agent/suggestion-generator";

/** What the empty states show, locked, before anything is connected: three
 * shapes from the one catalogue that work on a fresh account, so the preview
 * promises nothing the generator would not later offer. One list rather than
 * two, shared by the agent's empty state and the dashboard's cards. */
const PREVIEW_IDS = ["sheet_from_paste", "doc_from_paste", "week_calendar"] as const;

export const PREVIEW_SUGGESTIONS: Suggestion[] = PREVIEW_IDS.map((id) => {
  const shape = SHAPES.find((s) => s.id === id);
  if (!shape) throw new Error(`preview shape ${id} is not in the catalogue`);
  return { id: shape.id, text: shape.text };
});

/** The non-Google services' ServiceIcon keys. Google's come from the shape's
 * own `needs.google`, which names the product (gmail, docs, …). */
const SERVICE_ICON: Record<string, string> = {
  atlassian: "jira",
  notion: "notion",
  slack: "slack",
};

/** The ServiceIcon keys a suggestion runs on (SCRUM-482), read from the
 * catalogue entry its id names, so a card's tag cannot drift from what the
 * shape needs. Google products first, then each other service; an id the
 * catalogue does not hold gets none. */
export function suggestionServiceIcons(id: string): string[] {
  const shape = SHAPES.find((s) => s.id === id);
  if (!shape) return [];
  const icons = [...(shape.needs.google ?? [])];
  for (const service of shape.needs.services) {
    const icon = SERVICE_ICON[service];
    if (icon && !icons.includes(icon)) icons.push(icon);
  }
  return icons;
}
