#!/usr/bin/env node
// The check a registry change file must pass before the registry workflow
// will run it (SCRUM-423).
//
//   node scripts/registry-file-check.mjs <file> [--sha256 <hex>]
//
// It accepts EXACTLY the shape scripts/registry-diff.mjs writes and nothing
// else. It is not a SQL parser with a list of forbidden statements; it is a
// grammar of the one file shape that is allowed, so anything it was not
// written for is refused without having been thought of.
//
// HOW IT READS A FILE. First every string literal and every line comment is
// lifted out and replaced by a placeholder, reading literals the way the
// server does with standard_conforming_strings on (a quote doubles, a
// backslash is an ordinary character). What is left, the skeleton, holds no
// text a tool's author wrote, so a description can never be read as a
// statement. The skeleton is then matched against the generator's templates,
// statement by statement, and the lifted values are checked for what they
// must be (a slug, a tool name, an md5, a JSON object).
//
// WHERE THE SERVER WOULD READ IT DIFFERENTLY, IT IS REFUSED. A dollar-quoted
// body ends at the first copy of its tag even inside a quoted string, so the
// tag may appear exactly twice in the whole text. A prefixed string (E'..',
// U&'..') would change how a backslash reads, so a quote may not follow a
// letter. A backslash, a block comment, a quoted identifier or a carriage
// return outside a literal is refused outright.
//
// It opens no connection and runs nothing.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const TAG = "$registry_change$";
export const MAX_ROW_STATEMENTS = 40;

const STR = "\u0001"; // a string literal, lifted out
const COM = "\u0002"; // a line comment, lifted out
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const TOOL = /^[A-Za-z0-9_.-]+$/;
const MD5 = /^[0-9a-f]{32}$/;
const BOOL = "(true|false|NULL)";

class Refusal extends Error {}
const refuse = (why) => {
  throw new Refusal(why);
};

/** Lifts out literals and comments. Returns the skeleton and, in order, the
 * values of the literals and the text of the comments. */
export function tokenize(text) {
  if (text.includes("\u0000")) refuse("the file holds a NUL character");
  if (text.includes("\r")) refuse("the file has a carriage return; registry files have Unix line ends");
  if (text.includes(STR) || text.includes(COM)) refuse("the file holds a control character the check reserves");
  const tagCount = text.split(TAG).length - 1;
  if (tagCount !== 2) refuse(`the block tag ${TAG} appears ${tagCount} times; it must appear exactly twice`);

  let skeleton = "";
  const strings = [];
  const comments = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      if (/[A-Za-z0-9_&]$/.test(skeleton)) refuse("a string literal directly after a letter (a prefixed string such as E'...')");
      let value = "";
      i += 1;
      for (;;) {
        if (i >= text.length) refuse("a string literal is not closed");
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += text[i];
        i += 1;
      }
      strings.push(value);
      skeleton += STR;
      continue;
    }
    if (c === "-" && text[i + 1] === "-") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      comments.push(text.slice(i + 2, stop));
      skeleton += COM;
      i = stop;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") refuse("a block comment");
    if (c === "\\") refuse("a backslash outside a string literal");
    if (c === '"') refuse("a quoted identifier");
    if (c === "$") {
      if (!text.startsWith(TAG, i)) refuse("a dollar sign that is not the block tag");
      skeleton += TAG;
      i += TAG.length;
      continue;
    }
    skeleton += c;
    i += 1;
  }
  return { skeleton, strings, comments };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A template line: literal text with S for a string literal and C for a
 * comment; `(..)` groups pass through as regex. */
const T = (...lines) => new RegExp(lines.map((l) => l).join("\n") + "\n", "y");
const S = STR;
const C = COM;

const UPDATE = T(
  `  ${C}`,
  `  UPDATE tools t SET description = ${S}, input_schema_json = ${S}::jsonb, read_only_hint = ${BOOL}, updated_at = now\\(\\)`,
  `  FROM mcp_servers s`,
  `  WHERE s\\.id = t\\.mcp_server_id AND s\\.slug = ${S} AND t\\.name = ${S}`,
  `    AND md5\\(t\\.description\\) = ${S}`,
  `    AND md5\\(t\\.input_schema_json::text\\) = ${S}`,
  `    AND t\\.read_only_hint IS NOT DISTINCT FROM ${BOOL}`,
  `  ;`,
  `  GET DIAGNOSTICS n = ROW_COUNT;`,
  `  IF n <> 1 THEN RAISE EXCEPTION ${S}, n; END IF;`,
  ``
);
const INSERT = T(
  `  ${C}`,
  `  INSERT INTO tools \\(mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint\\)`,
  `  SELECT s\\.id, ${S}, ${S},`,
  `    ${S},`,
  `    ${S}::jsonb,`,
  `    ${BOOL}`,
  `  FROM mcp_servers s`,
  `  WHERE s\\.slug = ${S}`,
  `    AND NOT EXISTS \\(SELECT 1 FROM tools t WHERE t\\.namespaced_name = ${S}\\);`,
  `  GET DIAGNOSTICS n = ROW_COUNT;`,
  `  IF n <> 1 THEN RAISE EXCEPTION ${S}, n; END IF;`,
  ``
);
const DELETE = T(
  `  ${C}`,
  `  DELETE FROM tools t USING mcp_servers s`,
  `  WHERE s\\.id = t\\.mcp_server_id AND s\\.slug = ${S} AND t\\.name = ${S}`,
  `    AND md5\\(t\\.description\\) = ${S}`,
  `    AND md5\\(t\\.input_schema_json::text\\) = ${S};`,
  `  GET DIAGNOSTICS n = ROW_COUNT;`,
  `  IF n <> 1 THEN RAISE EXCEPTION ${S}, n; END IF;`,
  ``
);
// Header comments, a blank line, then the transaction and the block opening.
const HEAD_RE = new RegExp(`(?:${C}\\n)+\\nBEGIN;\\nSET LOCAL standard_conforming_strings = on;\\nDO ${esc(TAG)}\\nDECLARE n int;\\nBEGIN\\n`, "y");
const TAIL = new RegExp(
  [
    `  SELECT count\\(\\*\\) INTO n FROM tools t JOIN mcp_servers s ON s\\.id = t\\.mcp_server_id WHERE s\\.slug = ${S};`,
    `  IF n <> (\\d+) THEN RAISE EXCEPTION ${S}, n; END IF;`,
    `END`,
    `${esc(TAG)};`,
    `SELECT t\\.name, md5\\(t\\.description\\) AS description_md5, md5\\(t\\.input_schema_json::text\\) AS schema_md5, t\\.read_only_hint, t\\.updated_at`,
    `FROM mcp_servers s JOIN tools t ON s\\.id = t\\.mcp_server_id`,
    `WHERE s\\.slug = ${S} AND t\\.name IN \\(${S}(?:, ${S})*\\);`,
    `COMMIT;`,
    ``,
  ].join("\n") + "$",
  "y"
);

const countOf = (s, ch) => s.split(ch).length - 1;

/**
 * Checks one file's text. Returns what it changes, or throws a Refusal whose
 * message says why. Every refusal is a reason a reviewer could read.
 */
export function checkRegistryFile(text) {
  const { skeleton, strings, comments } = tokenize(text);
  let si = 0;
  let ci = 0;
  const take = (n) => strings.slice(si, (si += n));
  const takeComment = () => comments[ci++];

  HEAD_RE.lastIndex = 0;
  const head = HEAD_RE.exec(skeleton);
  if (!head) refuse("the file does not open as a registry change: header comments, a blank line, BEGIN, the SET LOCAL line, the DO block");
  ci += countOf(head[0], COM);
  let pos = HEAD_RE.lastIndex;

  const ops = [];
  let slug = null;
  const sameSlug = (s) => {
    if (!SLUG.test(s)) refuse(`${JSON.stringify(s)} is not a plugin slug`);
    if (slug === null) slug = s;
    else if (s !== slug) refuse(`the file names two plugins, ${slug} and ${s}; one file changes one plugin`);
  };
  const toolName = (s) => {
    if (!TOOL.test(s)) refuse(`${JSON.stringify(s)} is not a tool name`);
    return s;
  };
  const md5 = (s) => {
    if (!MD5.test(s)) refuse(`${JSON.stringify(s)} is not an md5`);
  };
  const schema = (s) => {
    let v;
    try {
      v = JSON.parse(s);
    } catch {
      refuse("an input schema is not JSON");
    }
    if (v === null || typeof v !== "object" || Array.isArray(v)) refuse("an input schema is not a JSON object");
  };
  const raise = (s, name, verb) => {
    const m = /^(forward|rollback) ([A-Za-z0-9_.-]+): expected 1 row, (updated|inserted|deleted) %$/.exec(s);
    if (!m || m[2] !== name || m[3] !== verb) refuse(`the guard's message for ${name} is not the generator's`);
  };

  for (;;) {
    let matched = null;
    for (const [kind, re] of [
      ["update", UPDATE],
      ["insert", INSERT],
      ["delete", DELETE],
    ]) {
      re.lastIndex = pos;
      const m = re.exec(skeleton);
      if (m) {
        matched = { kind, m };
        break;
      }
    }
    if (!matched) break;
    const { kind, m } = matched;
    pos += m[0].length;
    const comment = (takeComment() ?? "").trim();
    if (kind === "update") {
      const [description, schemaText, slugS, name, descMd5, schemaMd5, guardMsg] = take(7);
      void description;
      schema(schemaText);
      sameSlug(slugS);
      toolName(name);
      md5(descMd5);
      md5(schemaMd5);
      raise(guardMsg, name, "updated");
      if (comment !== name) refuse(`the comment above the update of ${name} does not name it`);
      ops.push({ op: "changes", name });
    } else if (kind === "insert") {
      const [name, namespaced, description, schemaText, slugS, notExists, guardMsg] = take(7);
      void description;
      toolName(name);
      sameSlug(slugS);
      if (namespaced !== `${slugS}__${name}` || notExists !== namespaced) {
        refuse(`the insert of ${name} does not name it as ${slugS}__${name} in both places`);
      }
      schema(schemaText);
      raise(guardMsg, name, "inserted");
      if (comment !== `${name}: a new row`) refuse(`the comment above the insert of ${name} does not name it`);
      ops.push({ op: "adds", name });
    } else {
      const [slugS, name, descMd5, schemaMd5, guardMsg] = take(5);
      sameSlug(slugS);
      toolName(name);
      md5(descMd5);
      md5(schemaMd5);
      raise(guardMsg, name, "deleted");
      if (comment !== `${name}: the row goes`) refuse(`the comment above the delete of ${name} does not name it`);
      ops.push({ op: "removes", name });
    }
    if (ops.length > MAX_ROW_STATEMENTS) refuse(`more than ${MAX_ROW_STATEMENTS} row statements in one file`);
  }
  if (ops.length === 0) refuse("the file changes no row, or a statement in it is not one the generator writes");

  TAIL.lastIndex = pos;
  const tail = TAIL.exec(skeleton);
  if (!tail) refuse("after the row statements the file does not close as the generator closes it (the row count, END, the read, COMMIT, nothing after)");
  const [countSlug, countMsg, readSlug, ...names] = strings.slice(si);
  sameSlug(countSlug);
  sameSlug(readSlug);
  const expected = Number(tail[1]);
  if (countMsg !== `rows for ${slug}: expected ${expected}, found %`) refuse("the row-count guard's message is not the generator's");
  const touched = [...new Set(ops.map((o) => o.name))].sort();
  if (JSON.stringify([...names].sort()) !== JSON.stringify(touched)) {
    refuse("the closing read does not name exactly the rows the file touches");
  }
  if (ops.length !== touched.length) refuse("a row is touched twice in one file");
  return { slug, ops, expectedRows: expected };
}

export const sha256Of = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** The request a reviewer reads: what runs, against which plugin, by what
 * file, under which sha256. */
export function requestLines(path, text, result) {
  return [
    `File: ${path}`,
    `sha256: ${sha256Of(text)}`,
    `Plugin: ${result.slug}, ${result.expectedRows} rows after the change`,
    ...result.ops.map((o) => `  ${o.op} ${o.name}`),
  ];
}

function main(argv) {
  const [path, flag, want] = argv;
  if (!path) {
    console.error("usage: registry-file-check.mjs <file> [--sha256 <hex>]");
    return 2;
  }
  const text = readFileSync(path, "utf8");
  let result;
  try {
    result = checkRegistryFile(text);
  } catch (err) {
    if (err instanceof Refusal) {
      console.error(`registry-file-check: REFUSED ${path}: ${err.message}`);
      return 1;
    }
    throw err;
  }
  if (flag === "--sha256") {
    if (!/^[0-9a-f]{64}$/.test(want ?? "")) {
      console.error("registry-file-check: --sha256 needs 64 lowercase hex characters");
      return 2;
    }
    if (sha256Of(text) !== want) {
      console.error(`registry-file-check: REFUSED ${path}: its sha256 is ${sha256Of(text)}, not the ${want} the run was asked for`);
      return 1;
    }
  }
  console.log(requestLines(path, text, result).join("\n"));
  return 0;
}

export { Refusal };

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
