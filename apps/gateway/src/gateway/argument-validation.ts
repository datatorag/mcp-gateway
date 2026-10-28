/**
 * Top-level argument validation against a tool's registry input schema
 * (SCRUM-392). Pure: no database, no dispatch. The dispatch in mcp-server.ts
 * is meant to call this after the allowance gate and `account` handling and
 * before any token resolution or plugin call, so a call with a missing
 * required argument or a misspelled one is refused by the gateway with words
 * instead of reaching the plugin and coming back as an opaque 400.
 *
 * Deliberately shallow: names only, never types, never nested objects. Those
 * stay with the plugin.
 */

import { echoName } from "./skills-catalogue";

export type ArgumentValidation =
  | { ok: true }
  | {
      ok: false;
      missing: string[];
      unknown: string[];
      /** unknown name -> closest known property, when one is close enough. */
      suggestions: Record<string, string>;
      /** An alias given together with the argument it stands for (SCRUM-458). */
      conflicts: Array<{ alias: string; canonical: string }>;
    };

/** The schema keyword a plugin declares an alias with (SCRUM-456): the
 * property is accepted as the argument it names, mapped by the plugin. */
const ALIAS_OF = "x-alias-of";

/** alias name -> canonical name, for every property declaring one. */
function aliasesIn(properties: Record<string, unknown> | null): Map<string, string> {
  const aliases = new Map<string, string>();
  if (!properties) return aliases;
  for (const [name, spec] of Object.entries(properties)) {
    const of = spec && typeof spec === "object" ? (spec as Record<string, unknown>)[ALIAS_OF] : undefined;
    if (typeof of === "string") aliases.set(name, of);
  }
  return aliases;
}

type ObjectSchema = {
  type?: unknown;
  properties?: Record<string, unknown>;
  required?: unknown;
  additionalProperties?: unknown;
};

export function validateArguments(
  schema: unknown,
  args: Record<string, unknown> | undefined,
  allowedExtra: readonly string[] = [],
): ArgumentValidation {
  const s = (schema ?? {}) as ObjectSchema;
  const given = new Set(Object.keys(args ?? {}));
  const required = Array.isArray(s.required)
    ? s.required.filter((r): r is string => typeof r === "string")
    : [];
  const properties =
    s.properties && typeof s.properties === "object" ? s.properties : null;

  // SCRUM-458: an alias stands for its canonical argument, which the plugin
  // maps before its own checks; here a required name counts as given when an
  // alias of it is, and the two together are refused as the plugin refuses them.
  const aliases = aliasesIn(properties);
  const missing = required.filter(
    (r) => !given.has(r) && ![...aliases].some(([alias, canonical]) => canonical === r && given.has(alias))
  );
  const conflicts = [...aliases]
    .filter(([alias, canonical]) => given.has(alias) && given.has(canonical))
    .map(([alias, canonical]) => ({ alias, canonical }));
  const extrasAllowed =
    s.additionalProperties === true ||
    (typeof s.additionalProperties === "object" && s.additionalProperties !== null);

  const unknown: string[] = [];
  const suggestions: Record<string, string> = {};
  if (properties && !extrasAllowed) {
    const known = Object.keys(properties);
    for (const name of given) {
      // Own properties only: "constructor" or "toString" is not a declared
      // argument because every object answers to it.
      if (Object.hasOwn(properties, name) || allowedExtra.includes(name)) continue;
      unknown.push(name);
      const close = closest(name, known);
      if (close) suggestions[name] = close;
    }
  }

  if (missing.length === 0 && unknown.length === 0 && conflicts.length === 0) return { ok: true };
  return { ok: false, missing, unknown, suggestions, conflicts };
}

/** The refusal text the dispatch returns. Says "unknown" and "required" so
 *  a reader (and the contract probe) can tell it is the gateway speaking. */
export function argumentRefusalText(
  toolName: string,
  v: Extract<ArgumentValidation, { ok: false }>,
  required: readonly string[],
): string {
  // Both an alias and its argument: the plugin's own words for it, so the two
  // layers say one thing (`validateArgs` in gws-mcp).
  if (v.conflicts.length > 0) {
    const { alias, canonical } = v.conflicts[0];
    return `${toolName}: give "${canonical}" or "${alias}", not both. Nothing was sent.`;
  }
  const parts: string[] = [];
  for (const u of v.unknown) {
    const hint = v.suggestions[u] ? ` (did you mean "${echoName(v.suggestions[u])}"?)` : "";
    // The name is the caller's own text: echoed stripped of control
    // characters and bounded, as every other echoed name is.
    parts.push(`unknown argument "${echoName(u)}"${hint}`);
  }
  if (v.missing.length > 0) {
    parts.push(`missing required argument${v.missing.length > 1 ? "s" : ""}: ${v.missing.join(", ")}`);
  }
  const req = required.length > 0 ? ` Required: ${required.join(", ")}.` : "";
  return `${toolName}: ${parts.join("; ")}.${req} Nothing was sent.`;
}

/** Closest known name by edit distance, within a third of the name's length
 *  (minimum 2). `body` vs `comment` is not close; `commnet` is. */
function closest(name: string, known: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const k of known) {
    const d = levenshtein(name.toLowerCase(), k.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  const limit = Math.max(2, Math.floor(name.length / 3));
  return bestD <= limit ? best : undefined;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}
