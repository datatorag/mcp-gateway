import type { ToolDef } from "./annotations.js";

/**
 * Check call arguments against the tool's own `inputSchema`, at the boundary.
 *
 * The MCP low-level `Server` does not validate against `inputSchema` — the
 * schema is advertised to the model and then nothing enforces it. So a missing
 * required argument travelled all the way to Google as `undefined` and came
 * back as an error about GOOGLE's state rather than the caller's input:
 * `sheets_rename_tab` without `title` produced `No sheet named "undefined" in
 * this spreadsheet`, which sends someone looking for a tab they never named.
 * An unknown argument was worse than wrong, it was silent: `docs_write` called
 * with `content` instead of `text` had `content` dropped on the floor and the
 * missing `text` reported by Google as a malformed insertText request.
 *
 * Both failures share one cause and get one fix, here, rather than sixty
 * hand-written guards that drift. The rule for what belongs in this file: it
 * validates what the schema already claims, and nothing else. It also unwraps a
 * JSON string that decodes to the declared array or object type, because a
 * client's transport can double-encode a value that was otherwise correct, and
 * losing the call over the envelope helps nobody. Anything needing knowledge of
 * the API beyond the schema stays in the handler.
 */

/** JSON-schema `type` names we check. Anything else is accepted unchecked
 * rather than guessed at — a wrong rejection here blocks a legitimate call. */
type CheckedType = "string" | "number" | "boolean" | "array" | "object";

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function describe(value: unknown): string {
  const seen = typeOf(value);
  if (seen === "string") return `a string (${JSON.stringify(value)})`;
  if (seen === "array" || seen === "object") return `${seen === "array" ? "an" : "an"} ${seen}`;
  return `${seen === "undefined" ? "nothing" : `a ${seen} (${String(value)})`}`;
}

/**
 * The value a double-encoded string stands for, when it decodes to exactly
 * the declared container type (per SCRUM-269); `undefined` otherwise. Only
 * arrays and objects: a number or boolean sent as a string is a deliberate
 * rejection, and coercing it would change what the value means.
 */
function unwrapJsonString(value: string, expected: "array" | "object"): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  return typeOf(parsed) === expected ? parsed : undefined;
}

/**
 * Throws with a caller-facing message when `args` does not satisfy `tool`.
 * Returns silently otherwise. Mutates `args` in place when it unwraps a
 * JSON-encoded array or object, so the handler reading the same object sees
 * the decoded value.
 */
export function validateArgs(tool: ToolDef, args: Record<string, unknown>): void {
  const properties = tool.inputSchema.properties as Record<
    string,
    { type?: string; enum?: unknown[]; minLength?: number } | undefined
  >;
  const known = Object.keys(properties);

  // 1. Unknown arguments. Dropping these silently is what made a misspelled
  //    parameter look like a server-side problem, so name the accepted set —
  //    the caller is usually one character away from the right key.
  const unknown = Object.keys(args).filter((key) => !(key in properties));
  if (unknown.length > 0) {
    throw new Error(
      `${tool.name}: unknown ${unknown.length === 1 ? "parameter" : "parameters"} ` +
        `${unknown.map((k) => `"${k}"`).join(", ")}. ` +
        `Accepted: ${known.map((k) => `"${k}"`).join(", ")}.`
    );
  }

  // 2. Missing required arguments. `null` counts as missing: no tool here
  //    means it as a value, and letting it through recreates the
  //    `"undefined"`-in-an-error-message failure with a different word.
  const missing = (tool.inputSchema.required ?? []).filter(
    (key) => args[key] === undefined || args[key] === null
  );
  if (missing.length > 0) {
    throw new Error(
      `${tool.name}: missing required ${missing.length === 1 ? "parameter" : "parameters"} ` +
        `${missing.map((k) => `"${k}"`).join(", ")}.`
    );
  }

  // 3. Types and enums, for the arguments that are present. Absent optional
  //    arguments are not an error — that is what optional means.
  for (const [key, original] of Object.entries(args)) {
    let value = original;
    if (value === undefined) continue;
    const spec = properties[key];
    if (!spec) continue;

    const expected = spec.type as CheckedType | undefined;
    if (expected && ["string", "number", "boolean", "array", "object"].includes(expected)) {
      // A JSON string holding exactly the declared array or object is the
      // right value in the wrong envelope: unwrap it and validate what it held.
      if ((expected === "array" || expected === "object") && typeof value === "string") {
        const unwrapped = unwrapJsonString(value, expected);
        if (unwrapped !== undefined) {
          args[key] = unwrapped;
          value = unwrapped;
        }
      }
      const seen = typeOf(value);
      // JSON has one number type; an integer is a number and both are fine.
      const ok = expected === "object" ? seen === "object" : seen === expected;
      if (!ok) {
        throw new Error(
          `${tool.name}: parameter "${key}" must be ${
            expected === "array" || expected === "object" ? "an" : "a"
          } ${expected}, received ${describe(value)}.`
        );
      }
    }

    if (spec.enum && !spec.enum.includes(value as never)) {
      throw new Error(
        `${tool.name}: parameter "${key}" must be one of ` +
          `${spec.enum.map((v) => `"${String(v)}"`).join(", ")}, received ${describe(value)}.`
      );
    }

    // `minLength` is the one way a schema can say "required, and not empty".
    // Only checked on strings: the type check above has already rejected
    // anything else, and a `minLength` on a non-string property is a schema
    // mistake this file has no business guessing about.
    if (spec.minLength !== undefined && typeof value === "string" && value.length < spec.minLength) {
      throw new Error(
        `${tool.name}: parameter "${key}" must be at least ${spec.minLength} ` +
          `${spec.minLength === 1 ? "character" : "characters"}, received ${describe(value)}.`
      );
    }
  }
}

/**
 * Reject a string that is empty or only whitespace, for a handler whose API
 * would accept it and store it. `minLength: 1` in the schema advertises the
 * rule to the caller and catches `""` at the boundary; it cannot express
 * "not just spaces", so that half lives here, exported so every handler with
 * the same need uses the same check and the same message.
 *
 * Returns the value untrimmed: normalising someone's name for them is a
 * second, unasked-for edit.
 */
export function requireNonBlank(toolName: string, key: string, value: string): string {
  if (value.trim() === "") {
    throw new Error(`${toolName}: "${key}" must not be blank.`);
  }
  return value;
}
