/**
 * Error-message redaction for every stored/exported sink (SCRUM-176).
 *
 * The constraint that does not move: user content must never enter our logs.
 * The old implementation enforced it with a blanket rule, "any quoted string
 * over 40 characters is content", which cannot tell an API's own diagnostic
 * from a user's data: a JSON error envelope quotes everything, so every
 * Google error message past 40 characters was destroyed by construction and
 * the stored rows were undiagnosable.
 *
 * The fix redacts by FIELD, not by shape. A recognised error envelope is
 * parsed, rebuilt from an ALLOWLIST of diagnostic fields, and every kept
 * string value is still scrubbed by the blanket rules, so an email, a long
 * id, or a quoted run of user content INSIDE a diagnostic still dies.
 * Unknown fields are dropped entirely, never passed through. Anything that
 * does not parse, or parses to a shape we do not recognise, takes the old
 * blanket path unchanged: ambiguity resolves to content, and fails closed.
 */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const GOOGLE_ID_RE = /\b[A-Za-z0-9_-]{20,}\b/g;
const LONG_QUOTED_RE = /(["'])([^"'\n]{41,})\1/g;

const MAX_LEN = 500;

/** The blanket scrubbers, applied in the original order. This is both the
 * fallback for unrecognised messages and the per-value scrub inside kept
 * diagnostic fields. */
function scrubText(text: string): string {
  let out = text;
  out = out.replace(EMAIL_RE, "[redacted-email]");
  out = out.replace(LONG_QUOTED_RE, (_m, q) => `${q}[redacted-content]${q}`);
  out = out.replace(GOOGLE_ID_RE, "[redacted-id]");
  return out;
}

/** Diagnostic fields we keep, by name. Everything else in an envelope is
 * dropped — not masked, dropped — because an unknown key is exactly where
 * content hides, and a key name itself can carry it. */
const KEEP_STRING_FIELDS = new Set([
  "message",
  "reason",
  "status",
  "domain",
  "location",
  "locationType",
  "field",
  "description",
  "@type",
]);
const KEEP_NUMBER_FIELDS = new Set(["code"]);
/** Nested collections Google uses for per-item diagnostics. Recursed with
 * the same allowlist, capped so an adversarial envelope cannot balloon. */
const KEEP_ARRAY_FIELDS = new Set(["errors", "details", "fieldViolations"]);
const MAX_ARRAY_ITEMS = 3;
const MAX_DEPTH = 3;

type Sanitized = Record<string, unknown>;

function sanitizeEnvelopeObject(obj: unknown, depth: number): Sanitized | null {
  if (depth > MAX_DEPTH) return null;
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
  const out: Sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (KEEP_NUMBER_FIELDS.has(key) && typeof value === "number") {
      out[key] = value;
    } else if (KEEP_STRING_FIELDS.has(key) && typeof value === "string") {
      out[key] = scrubText(value);
    } else if (KEEP_ARRAY_FIELDS.has(key) && Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => sanitizeEnvelopeObject(item, depth + 1))
        .filter((item): item is Sanitized => item !== null);
      if (items.length > 0) out[key] = items;
    }
    // Anything else: dropped. Fail closed.
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** True when the parsed object looks like an error envelope we understand:
 * either `{ error: {...} }` or a bare object carrying diagnostic fields. */
function sanitizeRecognisedEnvelope(parsed: unknown): Sanitized | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const asRecord = parsed as Record<string, unknown>;
  if (typeof asRecord.error === "object" && asRecord.error !== null) {
    const inner = sanitizeEnvelopeObject(asRecord.error, 1);
    return inner ? { error: inner } : null;
  }
  const hasDiagnosticShape =
    "code" in asRecord || "message" in asRecord || "reason" in asRecord || "status" in asRecord;
  return hasDiagnosticShape ? sanitizeEnvelopeObject(asRecord, 1) : null;
}

export function redactErrorMessage(input: string | null): string | null {
  if (input === null) return null;
  if (input === "") return "";

  // Field-aware path: if the message embeds a JSON object we can parse and
  // recognise as an error envelope, rebuild it from the allowlist. The prose
  // around the envelope still gets the blanket scrub.
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(input.slice(start, end + 1));
      const sanitized = sanitizeRecognisedEnvelope(parsed);
      if (sanitized !== null) {
        let out =
          scrubText(input.slice(0, start)) +
          JSON.stringify(sanitized) +
          scrubText(input.slice(end + 1));
        if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN);
        return out;
      }
    } catch {
      // Not JSON after all: fall through to the blanket path.
    }
  }

  // Blanket path, byte-for-byte the old behavior: unrecognised means content.
  let out = scrubText(input);
  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN);
  return out;
}
