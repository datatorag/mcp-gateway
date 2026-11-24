/**
 * The product marks a persona file may name in its `marks` field
 * (SCRUM-508): the persona's icon in the site's menu is the mark, or the
 * two marks, of the products it is about. Each name is a file the site
 * already ships, `public/icons/services/<name>.svg`, shown unmodified.
 *
 * No imports, so the content parser on the server and the menu in the
 * browser both read the one list. The label is the product's name, for the
 * tile's text alternative.
 */
export const PERSONA_MARK_LABELS = {
  gmail: "Gmail",
  sheets: "Google Sheets",
  jira: "Jira",
  confluence: "Confluence",
} as const;

export type PersonaMark = keyof typeof PERSONA_MARK_LABELS;

/** A tile holds one mark, or two composed. */
export const MAX_PERSONA_MARKS = 2;

export function isPersonaMark(value: string): value is PersonaMark {
  return Object.hasOwn(PERSONA_MARK_LABELS, value);
}

/** The marks a file names, or none when the list is empty, too long, or has
 * a name that is not a mark: a tile is never drawn from half a list. */
export function personaMarks(values: readonly string[]): PersonaMark[] {
  if (values.length === 0 || values.length > MAX_PERSONA_MARKS) return [];
  return values.every(isPersonaMark) ? [...values] : [];
}
