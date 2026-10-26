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
