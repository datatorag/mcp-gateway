/** Notion property values as plain JSON values.
 *
 * A Notion property value is a typed envelope: a select is
 * `{type: "select", select: {id, name, color}}`, a title is an array of rich
 * text objects each carrying annotations. A reader wants `"Done"` and
 * `"Quarterly plan"`. One function per property type turns the envelope into
 * the value; `decodeProperties` maps a page's whole `properties` object.
 *
 * A type this file does not know is never thrown on: its value is passed
 * through as Notion sent it, looked up by its type name, so a property type
 * Notion adds later still reaches the reader.
 */

type Json = unknown;
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Rich text as one string: the `plain_text` of each piece, joined. */
export function plainText(richText: unknown): string {
  return arr(richText)
    .map((t) => (isObj(t) && typeof t.plain_text === "string" ? t.plain_text : ""))
    .join("");
}

/** A user as a name, or the id when Notion sent a partial user with no name
 * (it does in `created_by` and for users the connection cannot see). */
export function userName(user: unknown): string | null {
  if (!isObj(user)) return null;
  return str(user.name) ?? str(user.id);
}

/** A date as its start alone when it has no end and no time zone, otherwise
 * as an object with what it has. */
export function decodeDate(date: unknown): Json {
  if (!isObj(date)) return null;
  const start = str(date.start);
  const end = str(date.end);
  const timeZone = str(date.time_zone);
  if (end === null && timeZone === null) return start;
  return timeZone === null ? { start, end } : { start, end, time_zone: timeZone };
}

const optionName = (v: unknown): string | null => (isObj(v) ? str(v.name) : null);

function fileValue(f: unknown): Json {
  if (!isObj(f)) return null;
  const inner = isObj(f.file) ? f.file : isObj(f.external) ? f.external : undefined;
  return { name: str(f.name), url: inner ? str(inner.url) : null };
}

function formulaValue(f: unknown): Json {
  if (!isObj(f)) return null;
  switch (f.type) {
    case "string":
      return str(f.string);
    case "number":
      return typeof f.number === "number" ? f.number : null;
    case "boolean":
      return typeof f.boolean === "boolean" ? f.boolean : null;
    case "date":
      return decodeDate(f.date);
    default:
      return typeof f.type === "string" ? (f[f.type] ?? null) : null;
  }
}

function rollupValue(r: unknown): Json {
  if (!isObj(r)) return null;
  switch (r.type) {
    case "number":
      return typeof r.number === "number" ? r.number : null;
    case "date":
      return decodeDate(r.date);
    case "array":
      // Each element is a property value of the rolled-up property's type.
      return arr(r.array).map((item) => decodeProperty(item));
    default:
      return typeof r.type === "string" ? (r[r.type] ?? null) : null;
  }
}

/** One decoder per property type, keyed by Notion's type name. */
export const DECODERS: Readonly<Record<string, (value: unknown, prop: Obj) => Json>> = {
  title: (v) => plainText(v),
  rich_text: (v) => plainText(v),
  number: (v) => (typeof v === "number" ? v : null),
  select: (v) => optionName(v),
  multi_select: (v) => arr(v).map(optionName),
  status: (v) => optionName(v),
  date: (v) => decodeDate(v),
  people: (v) => arr(v).map(userName),
  files: (v) => arr(v).map(fileValue),
  checkbox: (v) => v === true,
  url: (v) => str(v),
  email: (v) => str(v),
  phone_number: (v) => str(v),
  formula: (v) => formulaValue(v),
  // A page read lists at most 25 related pages and says so with has_more;
  // that is passed on rather than shown as the whole relation.
  relation: (v, prop) => {
    const ids = arr(v).map((r) => (isObj(r) ? str(r.id) : null));
    return prop.has_more === true ? { ids, has_more: true } : ids;
  },
  rollup: (v) => rollupValue(v),
  created_time: (v) => str(v),
  created_by: (v) => userName(v),
  last_edited_time: (v) => str(v),
  last_edited_by: (v) => userName(v),
  unique_id: (v) => {
    if (!isObj(v) || typeof v.number !== "number") return null;
    const prefix = str(v.prefix);
    return prefix ? `${prefix}-${v.number}` : v.number;
  },
  verification: (v) => (isObj(v) ? str(v.state) : null),
  // A button holds no value; Notion sends an empty object.
  button: () => null,
  place: (v) => {
    if (!isObj(v)) return null;
    const out: Obj = {};
    for (const key of ["name", "address", "lat", "lon"]) {
      if (v[key] !== undefined && v[key] !== null) out[key] = v[key];
    }
    return out;
  },
};

/** One property value as a plain value. */
export function decodeProperty(prop: unknown): Json {
  if (!isObj(prop) || typeof prop.type !== "string") return null;
  const value = prop[prop.type];
  const decoder = DECODERS[prop.type];
  return decoder ? decoder(value, prop) : (value ?? null);
}

/** A page's `properties` object as `{name: plainValue}`. */
export function decodeProperties(properties: unknown): Record<string, Json> {
  const out: Record<string, Json> = {};
  if (!isObj(properties)) return out;
  for (const [name, prop] of Object.entries(properties)) out[name] = decodeProperty(prop);
  return out;
}

/** A page's title: the value of its one title-typed property. */
export function pageTitle(properties: unknown): string {
  if (!isObj(properties)) return "";
  for (const prop of Object.values(properties)) {
    if (isObj(prop) && prop.type === "title") return plainText(prop.title);
  }
  return "";
}
