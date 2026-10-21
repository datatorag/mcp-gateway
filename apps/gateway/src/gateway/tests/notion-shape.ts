/**
 * What the Notion cases assert about an answer's shape (SCRUM-366).
 *
 * Shared because six cases read the same envelope and the same ids, and the
 * checks are the part that drifts when each case writes its own: an id
 * compared dashed against undashed fails on a working connector, and a list
 * check that only asks for an array passes on a tool that dropped
 * `has_more`.
 */

/** Two Notion ids name the same object. Notion answers dashed ids; a fixture
 * may be configured either way, and case is not significant in either. */
export function sameNotionId(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const norm = (v: string) => v.replace(/-/g, "").toLowerCase();
  return norm(a) !== "" && norm(a) === norm(b);
}

export type NotionList = { results: unknown[]; has_more: boolean; next_cursor: string | null };

/** The `{results, has_more, next_cursor}` envelope every Notion list tool
 * documents, each field present and of its type, or a throw naming which. */
export function notionList(what: string, value: unknown): NotionList {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${what} did not answer an object`);
  }
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.results)) throw new Error(`${what} answered no results list`);
  if (typeof v.has_more !== "boolean") throw new Error(`${what} answered has_more that is not a boolean`);
  if (!(v.next_cursor === null || typeof v.next_cursor === "string")) {
    throw new Error(`${what} answered next_cursor that is neither a string nor null`);
  }
  if (v.has_more && typeof v.next_cursor !== "string") {
    throw new Error(`${what} said has_more with no next_cursor to fetch the rest by`);
  }
  return { results: v.results, has_more: v.has_more, next_cursor: v.next_cursor as string | null };
}

/**
 * The name of the first property whose value is still Notion's typed
 * envelope rather than a plain value, or null when all are plain.
 *
 * An envelope is `{type: "select", select: {...}}`, an object naming its own
 * type as a key, or rich text, an array of objects carrying `plain_text`.
 * The plugin decodes both; a property that comes back in either form is the
 * decoding missing, which is what a reader of these tools would hit.
 */
export function rawProperty(properties: Record<string, unknown>): string | null {
  const isEnvelope = (v: unknown): boolean => {
    if (!v || typeof v !== "object") return false;
    if (Array.isArray(v)) return v.some((item) => !!item && typeof item === "object" && "plain_text" in item);
    const o = v as Record<string, unknown>;
    return typeof o.type === "string" && o.type in o;
  };
  for (const [name, value] of Object.entries(properties)) if (isEnvelope(value)) return name;
  return null;
}

/** The words the plugin answers for a page it cannot see: Notion gives one
 * 404 for a page that does not exist and one not shared with the
 * connection, and the plugin says so rather than claiming either. */
export function isNotionNotFound(text: string): boolean {
  return text.includes("Notion did not find this page") && text.includes("object_not_found");
}
