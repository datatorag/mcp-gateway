/** Plain values to Notion's typed envelopes, the write side of properties.ts.
 *
 * A reader of properties.ts gets `{"Status": "Done"}`; a writer here gives
 * the same and this file builds `{"Status": {"status": {"name": "Done"}}}`,
 * looking up each property's type in the data source schema. One encoder per
 * writable property type, keyed by Notion's type name like the decoders.
 *
 * Everything Notion would refuse with a 400 that can be known from the schema
 * is refused here first, in words: a property name the data source does not
 * have, a value of the wrong type, a select or status option that does not
 * exist, a list over Notion's 100 items, a text over what one value holds.
 * All problems in one call are reported together.
 *
 * Limits are the API reference's for version 2026-03-11: a rich text object
 * holds 2,000 characters and an array 100 objects; email and phone values
 * hold 100 characters, a URL 2,000.
 */

import { notionId } from "./notion-id.js";
import { decodeDate, plainText } from "./properties.js";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Characters in one rich text object. */
export const RICH_TEXT_MAX = 2000;
/** Objects in one array: rich text pieces, options, people, files, relations. */
export const ARRAY_MAX = 100;
const SHORT_STRING_MAX = 100;
const OPTION_DESCRIPTION_MAX = 280;

/** A refusal of the caller's input, before any request. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

function capped<T>(items: T[], what: string): T[] {
  if (items.length > ARRAY_MAX) {
    throw new InputError(`${what} takes at most ${ARRAY_MAX} items; it was given ${items.length}.`);
  }
  return items;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Text as Notion rich text: pieces of at most 2,000 characters, at most 100
 * pieces. A character written as two UTF-16 code units is never split. */
export function richText(text: string, what: string): Obj[] {
  const pieces: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(at + RICH_TEXT_MAX, text.length);
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end--;
    pieces.push(text.slice(at, end));
    at = end;
  }
  if (pieces.length > ARRAY_MAX) {
    throw new InputError(
      `${what} is ${text.length} characters, more than one Notion text value holds ` +
        `(${ARRAY_MAX} pieces of ${RICH_TEXT_MAX} characters, ${ARRAY_MAX * RICH_TEXT_MAX} in all).`
    );
  }
  return pieces.map((content) => ({ type: "text", text: { content } }));
}

/** The option names a select, multi_select or status schema entry holds. */
function optionNames(prop: Obj): string[] {
  const type = String(prop.type);
  const config = isObj(prop[type]) ? (prop[type] as Obj) : {};
  const options = Array.isArray(config.options) ? config.options : [];
  return options.map((o) => (isObj(o) && typeof o.name === "string" ? o.name : "")).filter((n) => n !== "");
}

function pickOption(value: string, prop: Obj, name: string): string {
  const names = optionNames(prop);
  if (names.includes(value)) return value;
  const near = names.find((n) => n.toLowerCase() === value.trim().toLowerCase());
  const known = names.length ? `Its options are: ${names.join(", ")}.` : "It has no options yet.";
  const hint = near ? ` The nearest is "${near}" (names match exactly).` : "";
  const add =
    prop.type === "status"
      ? ""
      : " A new option is added to the schema with notion_update_data_source.";
  throw new InputError(`"${value}" is not an option of ${name}. ${known}${hint}${add}`);
}

function shortString(value: unknown, name: string, type: string, max: number): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new InputError(`${name} is a ${type} property and takes a string, or null to clear it.`);
  if (value.length > max) {
    throw new InputError(`${name} is a ${type} property and holds at most ${max} characters; this value has ${value.length}.`);
  }
  return value;
}

function idList(value: unknown, name: string, type: string, what: string): string[] {
  if (!Array.isArray(value)) throw new InputError(`${name} is a ${type} property and takes a list of ${what}.`);
  capped(value, name);
  return value.map((v) => {
    try {
      return notionId(v, name);
    } catch {
      throw new InputError(`${name} is a ${type} property and takes a list of ${what}; ${JSON.stringify(v)} is not one.`);
    }
  });
}

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

function dateValue(value: unknown, name: string): Obj | null {
  if (value === null) return null;
  const words = `${name} is a date property and takes a date ("2026-10-20" or "2026-10-20T09:00:00Z"), an object {start, end, time_zone} with start set, or null to clear it.`;
  if (typeof value === "string") {
    if (!DATE_LIKE.test(value)) throw new InputError(words);
    return { start: value };
  }
  if (!isObj(value) || typeof value.start !== "string" || !DATE_LIKE.test(value.start)) throw new InputError(words);
  const out: Obj = { start: value.start };
  if (value.end !== undefined && value.end !== null) {
    if (typeof value.end !== "string" || !DATE_LIKE.test(value.end)) throw new InputError(words);
    out.end = value.end;
  }
  if (value.time_zone !== undefined && value.time_zone !== null) {
    if (typeof value.time_zone !== "string") throw new InputError(words);
    out.time_zone = value.time_zone;
  }
  return out;
}

function fileName(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last).slice(0, SHORT_STRING_MAX);
  } catch {
    // Not a URL Node can parse; Notion judges the link itself.
  }
  return url.slice(0, SHORT_STRING_MAX);
}

type Encoder = (value: unknown, prop: Obj, name: string) => unknown;

/** One encoder per property type a page write can set. The value returned
 * goes under the type's key: `{[type]: encoded}`. */
export const ENCODERS: Readonly<Record<string, Encoder>> = {
  title: (v, _p, name) => textEncoder(v, name, "title"),
  rich_text: (v, _p, name) => textEncoder(v, name, "rich_text"),
  number: (v, _p, name) => {
    if (v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new InputError(`${name} is a number property and takes a number, or null to clear it.`);
    }
    return v;
  },
  select: (v, p, name) => singleOption(v, p, name, "select"),
  status: (v, p, name) => singleOption(v, p, name, "status"),
  multi_select: (v, p, name) => {
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new InputError(`${name} is a multi_select property and takes a list of option names (an empty list clears it).`);
    }
    capped(v, name);
    return (v as string[]).map((n) => ({ name: pickOption(n, p, name) }));
  },
  date: (v, _p, name) => dateValue(v, name),
  people: (v, _p, name) =>
    idList(v, name, "people", "Notion user ids (notion_list_users lists them)").map((id) => ({ object: "user", id })),
  files: (v, _p, name) => {
    const words = `${name} is a files property and takes a list of links, each a URL string or {url, name}. Files stored in Notion are not written through this tool.`;
    if (!Array.isArray(v)) throw new InputError(words);
    capped(v, name);
    return v.map((f) => {
      const url = typeof f === "string" ? f : isObj(f) && typeof f.url === "string" ? f.url : null;
      if (!url) throw new InputError(words);
      if (url.length > RICH_TEXT_MAX) throw new InputError(`${name}: a link holds at most ${RICH_TEXT_MAX} characters.`);
      const given = isObj(f) && typeof f.name === "string" && f.name !== "" ? f.name : fileName(url);
      return { type: "external", name: given.slice(0, SHORT_STRING_MAX), external: { url } };
    });
  },
  checkbox: (v, _p, name) => {
    if (typeof v !== "boolean") throw new InputError(`${name} is a checkbox property and takes true or false.`);
    return v;
  },
  url: (v, _p, name) => shortString(v, name, "url", RICH_TEXT_MAX),
  email: (v, _p, name) => shortString(v, name, "email", SHORT_STRING_MAX),
  phone_number: (v, _p, name) => shortString(v, name, "phone_number", SHORT_STRING_MAX),
  relation: (v, _p, name) => idList(v, name, "relation", "page ids").map((id) => ({ id })),
  place: (v, _p, name) => {
    if (v === null) return null;
    if (!isObj(v) || typeof v.lat !== "number" || typeof v.lon !== "number") {
      throw new InputError(`${name} is a place property and takes {lat, lon} with optional name and address, or null to clear it.`);
    }
    const out: Obj = { lat: v.lat, lon: v.lon };
    for (const key of ["name", "address"]) if (typeof v[key] === "string") out[key] = v[key];
    return out;
  },
  verification: (v, _p, name) => {
    if (v !== "verified" && v !== "unverified") {
      throw new InputError(`${name} is a verification property and takes "verified" or "unverified".`);
    }
    return { state: v };
  },
};

function textEncoder(v: unknown, name: string, type: string): Obj[] {
  if (v === null) return [];
  if (typeof v !== "string") throw new InputError(`${name} is a ${type} property and takes a string, or null to clear it.`);
  return richText(v, name);
}

function singleOption(v: unknown, p: Obj, name: string, type: string): Obj | null {
  if (v === null) return null;
  if (typeof v !== "string") throw new InputError(`${name} is a ${type} property and takes one option name as a string, or null to clear it.`);
  return { name: pickOption(v, p, name) };
}

/** Types whose values Notion computes or stamps; a page write cannot set them. */
const SET_BY_NOTION = new Set([
  "formula",
  "rollup",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "unique_id",
  "button",
]);

/** Each property encoded on its own: the encoded ones and, by name, the
 * refusal for each one that could not be. */
export function encodePropertiesDetailed(
  values: unknown,
  schema: unknown
): { encoded: Obj; errors: Array<{ name: string; message: string }> } {
  if (!isObj(values)) throw new InputError("properties takes an object of property names to plain values.");
  const props = isObj(schema) ? schema : {};
  const encoded: Obj = {};
  const errors: Array<{ name: string; message: string }> = [];
  for (const [name, value] of Object.entries(values)) {
    const prop = props[name];
    if (!isObj(prop) || typeof prop.type !== "string") {
      errors.push({
        name,
        message: `This data source has no property named "${name}". Its properties are: ${Object.keys(props).join(", ")}.`,
      });
      continue;
    }
    const type = prop.type;
    try {
      if (SET_BY_NOTION.has(type)) {
        throw new InputError(`${name} is a ${type} property, which Notion sets; a page write cannot change it.`);
      }
      const encoder = ENCODERS[type];
      if (!encoder) throw new InputError(`${name} is a ${type} property, which this tool does not write.`);
      encoded[name] = { [type]: encoder(value, prop, name) };
    } catch (err) {
      if (!(err instanceof InputError)) throw err;
      errors.push({ name, message: err.message });
    }
  }
  return { encoded, errors };
}

/** Plain values to the `properties` of a page write, against a data source's
 * schema. Throws one InputError listing every problem. */
export function encodeProperties(values: unknown, schema: unknown): Obj {
  const { encoded, errors } = encodePropertiesDetailed(values, schema);
  if (errors.length) throw new InputError(errors.map((e) => e.message).join(" "));
  return encoded;
}

/* ---- Schemas: name to type, for a new database or a schema change ---- */

/** Property types a schema map can name with no settings, or with the
 * settings below. */
const SCHEMA_TYPES = new Set([
  "title",
  "rich_text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "people",
  "files",
  "checkbox",
  "url",
  "email",
  "phone_number",
  "formula",
  "relation",
  "rollup",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "unique_id",
  "place",
  "verification",
  "button",
]);

function schemaOptions(options: unknown, name: string, type: string): Obj[] {
  if (!Array.isArray(options)) throw new InputError(`${name}: options takes a list of option names.`);
  capped(options, name);
  return options.map((o) => {
    if (typeof o === "string" && o !== "") return { name: o };
    if (isObj(o) && typeof o.name === "string" && o.name !== "") {
      const out: Obj = { name: o.name };
      if (typeof o.color === "string") out.color = o.color;
      if (typeof o.description === "string") out.description = o.description;
      if (type === "status" && typeof o.group === "string") out.group = o.group;
      return out;
    }
    throw new InputError(`${name}: each option is a name, or {name, color, description${type === "status" ? ", group" : ""}}.`);
  });
}

/** One schema entry, `"date"` or `{type, ...settings}`, as Notion's
 * property configuration. */
function schemaEntry(name: string, spec: unknown): Obj {
  const s: Obj = typeof spec === "string" ? { type: spec } : isObj(spec) ? spec : {};
  const type = s.type;
  if (typeof type !== "string" || !SCHEMA_TYPES.has(type)) {
    throw new InputError(
      `${name}: ${JSON.stringify(type ?? spec)} is not a Notion property type this tool creates. Types: ${[...SCHEMA_TYPES].join(", ")}.`
    );
  }
  const out: Obj = {};
  if (s.config !== undefined) {
    if (!isObj(s.config)) throw new InputError(`${name}: config takes Notion's settings object for a ${type} property.`);
    out[type] = s.config;
  } else {
    out[type] = schemaConfig(name, type, s);
  }
  if (s.description !== undefined && s.description !== null) {
    if (typeof s.description !== "string" || s.description.length > OPTION_DESCRIPTION_MAX) {
      throw new InputError(`${name}: description takes a string of at most ${OPTION_DESCRIPTION_MAX} characters.`);
    }
    out.description = s.description;
  }
  return out;
}

function schemaConfig(name: string, type: string, s: Obj): Obj {
  switch (type) {
    case "number":
      return typeof s.format === "string" ? { format: s.format } : {};
    case "select":
    case "multi_select":
    case "status":
      return s.options === undefined ? {} : { options: schemaOptions(s.options, name, type) };
    case "formula":
      if (typeof s.expression !== "string" || s.expression === "") {
        throw new InputError(`${name}: a formula property takes an expression, in Notion's formula language.`);
      }
      return { expression: s.expression };
    case "relation": {
      if (s.data_source_id === undefined) {
        throw new InputError(`${name}: a relation property takes a data_source_id, the data source its pages relate to.`);
      }
      const id = notionId(s.data_source_id, `${name}.data_source_id`);
      return s.dual === true
        ? { data_source_id: id, type: "dual_property", dual_property: {} }
        : { data_source_id: id, type: "single_property", single_property: {} };
    }
    case "rollup":
      throw new InputError(
        `${name}: a rollup property takes config, Notion's rollup settings: {function, relation_property_name, rollup_property_name}.`
      );
    case "unique_id":
      return typeof s.prefix === "string" ? { prefix: s.prefix } : {};
    default:
      return {};
  }
}

/** A schema map for a new data source: `{name: type or {type, ...}}`.
 * Exactly one title property; the caller decides whether to add one. */
export function encodeSchemaMap(map: unknown): Obj {
  if (!isObj(map)) throw new InputError("properties takes an object of property names to types.");
  const out: Obj = {};
  const errors: string[] = [];
  for (const [name, spec] of Object.entries(map)) {
    try {
      out[name] = schemaEntry(name, spec);
    } catch (err) {
      if (!(err instanceof InputError)) throw err;
      errors.push(err.message);
    }
  }
  const titles = Object.values(out).filter((v) => isObj(v) && "title" in v).length;
  if (titles > 1) errors.push(`A data source has one title property; this map has ${titles}.`);
  if (errors.length) throw new InputError(errors.join(" "));
  return out;
}

/** Schema changes for an existing data source, keyed by the property's
 * current name or id: null removes it, `{name}` renames it, a type (alone or
 * with `name`) changes its type and settings. */
export function encodeSchemaUpdates(map: unknown): Obj {
  if (!isObj(map)) throw new InputError("properties takes an object of property names to changes.");
  const out: Obj = {};
  const errors: string[] = [];
  for (const [name, spec] of Object.entries(map)) {
    try {
      if (spec === null) {
        out[name] = null;
        continue;
      }
      const s: Obj = typeof spec === "string" ? { type: spec } : isObj(spec) ? spec : {};
      const rename = typeof s.name === "string" && s.name !== "" ? s.name : undefined;
      if (s.type === undefined) {
        if (!rename) throw new InputError(`${name}: an update names a new name, a type, or null to remove the property.`);
        out[name] = { name: rename };
        continue;
      }
      const { name: _drop, ...rest } = s;
      out[name] = rename ? { name: rename, ...schemaEntry(name, rest) } : schemaEntry(name, rest);
    } catch (err) {
      if (!(err instanceof InputError)) throw err;
      errors.push(err.message);
    }
  }
  if (errors.length) throw new InputError(errors.join(" "));
  return out;
}

/* ---- Duplicate: a read property back to a plain value ---- */

const ids = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map((x) => (isObj(x) && typeof x.id === "string" ? x.id : "")).filter((x) => x !== "");

/** A property as read from a page, as the plain value ENCODERS takes, or
 * undefined for a type a page write cannot set or this copy does not carry.
 * `dropped` names what part of the value could not be carried. Unlike the
 * reader's plain values, people and relations stay ids, so they can be
 * written back. */
export function copyableValue(prop: unknown): { value: unknown; dropped?: string } | undefined {
  if (!isObj(prop) || typeof prop.type !== "string") return undefined;
  const v = prop[prop.type];
  switch (prop.type) {
    case "title":
    case "rich_text":
      return { value: plainText(v) };
    case "number":
    case "checkbox":
    case "url":
    case "email":
    case "phone_number":
      return { value: v ?? null };
    case "select":
    case "status":
      return { value: isObj(v) && typeof v.name === "string" ? v.name : null };
    case "multi_select":
      return {
        value: (Array.isArray(v) ? v : []).map((o) => (isObj(o) ? o.name : null)).filter((n) => typeof n === "string"),
      };
    case "date": {
      const d = decodeDate(v);
      return { value: d };
    }
    case "people":
    case "relation":
      return { value: ids(v) };
    case "files": {
      const all = Array.isArray(v) ? v : [];
      const external = all
        .filter((f) => isObj(f) && f.type === "external" && isObj(f.external) && typeof f.external.url === "string")
        .map((f) => ({ name: (f as Obj).name, url: ((f as Obj).external as Obj).url }));
      const hosted = all.length - external.length;
      return hosted
        ? { value: external, dropped: `${hosted} file${hosted === 1 ? "" : "s"} stored in Notion` }
        : { value: external };
    }
    case "place":
      return isObj(v) ? { value: v } : { value: null };
    default:
      return undefined;
  }
}
