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

export type ArgumentValidation =
  | { ok: true }
  | {
      ok: false;
      missing: string[];
      unknown: string[];
      /** unknown name -> closest known property, when one is close enough. */
      suggestions: Record<string, string>;
    };

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
  const missing = required.filter((r) => !given.has(r));

  const properties =
    s.properties && typeof s.properties === "object" ? s.properties : null;
  const extrasAllowed =
    s.additionalProperties === true ||
    (typeof s.additionalProperties === "object" && s.additionalProperties !== null);

  const unknown: string[] = [];
  const suggestions: Record<string, string> = {};
  if (properties && !extrasAllowed) {
    const known = Object.keys(properties);
    for (const name of given) {
      if (name in properties || allowedExtra.includes(name)) continue;
      unknown.push(name);
      const close = closest(name, known);
      if (close) suggestions[name] = close;
    }
  }

  if (missing.length === 0 && unknown.length === 0) return { ok: true };
  return { ok: false, missing, unknown, suggestions };
}

/** The refusal text the dispatch returns. Says "unknown" and "required" so
 *  a reader (and the contract probe) can tell it is the gateway speaking. */
export function argumentRefusalText(
  toolName: string,
  v: Extract<ArgumentValidation, { ok: false }>,
  required: readonly string[],
): string {
  const parts: string[] = [];
  for (const u of v.unknown) {
    const hint = v.suggestions[u] ? ` (did you mean "${v.suggestions[u]}"?)` : "";
    parts.push(`unknown argument "${u}"${hint}`);
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
