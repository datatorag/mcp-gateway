const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const GOOGLE_ID_RE = /\b[A-Za-z0-9_-]{20,}\b/g;
const LONG_QUOTED_RE = /(["'])([^"'\n]{41,})\1/g;

const MAX_LEN = 500;

export function redactErrorMessage(input: string | null): string | null {
  if (input === null) return null;
  if (input === "") return "";
  let out = input;
  out = out.replace(EMAIL_RE, "[redacted-email]");
  out = out.replace(LONG_QUOTED_RE, (_m, q) => `${q}[redacted-content]${q}`);
  out = out.replace(GOOGLE_ID_RE, "[redacted-id]");
  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN);
  return out;
}
