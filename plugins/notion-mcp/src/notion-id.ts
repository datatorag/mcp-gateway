/** Notion ids from what a person pastes.
 *
 * A Notion id is 32 hex digits, written dashed (8-4-4-4-12) by the API and
 * undashed in a page's URL, where it follows the title slug:
 * `https://www.notion.so/Team-Notes-1f2e...`. A database URL can also carry a
 * view id in `?v=`, which is not the database; a page opened in a side peek
 * carries the page in `?p=`. A data source's URL in page markdown is
 * `collection://<id>`. All of these resolve to the dashed form here.
 */

/** 32 hex digits, undashed or dashed 8-4-4-4-12, with no hex digit touching
 * either end, so a title slug ending in hex letters ("Cafe-deadbeef-...")
 * cannot lend the match its first digits. */
const ID = /(?<![0-9a-f])(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f])/gi;
const BARE = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function dashed(hex32: string): string {
  const h = hex32.replace(/-/g, "").toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The dashed id in `value`, an id or a Notion URL. Throws in words when
 * there is none, naming the argument. */
export function notionId(value: unknown, argName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${argName} is required: a Notion id or a Notion URL.`);
  }
  const text = value.trim();
  if (BARE.test(text)) return dashed(text);

  // A side-peek URL names the page in ?p=; otherwise the query and fragment
  // hold a view or a block anchor, never the object, and are dropped.
  const queryAt = text.search(/[?#]/);
  if (queryAt !== -1) {
    const peek = /[?&]p=([0-9a-f-]{32,36})/i.exec(text.slice(queryAt));
    if (peek && BARE.test(peek[1])) return dashed(peek[1]);
  }
  const path = queryAt === -1 ? text : text.slice(0, queryAt);
  const found = path.match(ID);
  if (found) return dashed(found[found.length - 1]);
  throw new Error(
    `${argName} does not contain a Notion id. It takes a 32-character id (with or without dashes) or a Notion URL that ends in one.`
  );
}

/** The dashed id of a database view: a bare id, or the `?v=` of a database
 * URL. A URL without `?v=` names the database, not a view, and is refused. */
export function viewId(value: unknown, argName: string): string {
  if (typeof value === "string" && /[?#]/.test(value)) {
    const v = /[?&]v=([0-9a-f-]{32,36})(?![0-9a-f])/i.exec(value);
    if (v && BARE.test(v[1])) return dashed(v[1]);
    throw new Error(`${argName} takes a view id, or a database URL whose ?v= names the view; this URL has no ?v=.`);
  }
  if (typeof value === "string" && /^https?:/i.test(value.trim())) {
    throw new Error(`${argName} takes a view id, or a database URL whose ?v= names the view; this URL has no ?v=.`);
  }
  return notionId(value, argName);
}
