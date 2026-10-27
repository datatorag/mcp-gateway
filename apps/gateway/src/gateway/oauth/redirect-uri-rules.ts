/**
 * What a client may register as a redirect URI (SCRUM-373).
 *
 * The authorization code is sent wherever the client registered, so the rule
 * sits at registration: an https URL with a host, or http on a loopback host
 * (a native client's local callback, any port). No fragment, no userinfo, and
 * nothing else, so a custom app scheme is refused. Existing registrations are
 * not re-validated; this applies to new ones.
 */

export const MAX_REDIRECT_URIS = 5;
export const MAX_REDIRECT_URI_LENGTH = 512;

/** `URL.hostname` keeps the brackets on an IPv6 literal. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type RedirectUriCheck = { ok: true; uris: string[] } | { ok: false; description: string };

export function checkRedirectUris(value: unknown): RedirectUriCheck {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, description: "redirect_uris must be a non-empty array" };
  }
  if (value.length > MAX_REDIRECT_URIS) {
    return { ok: false, description: `redirect_uris may hold at most ${MAX_REDIRECT_URIS} URIs` };
  }
  for (const uri of value) {
    const refusal = redirectUriRefusal(uri);
    if (refusal) return { ok: false, description: refusal };
  }
  return { ok: true, uris: value as string[] };
}

function redirectUriRefusal(uri: unknown): string | null {
  if (typeof uri !== "string") return "every redirect URI must be a string";
  if (uri.length > MAX_REDIRECT_URI_LENGTH) {
    return `a redirect URI may be at most ${MAX_REDIRECT_URI_LENGTH} characters`;
  }
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return "a redirect URI does not parse as a URL";
  }
  // `new URL` drops an empty "#", so the raw string is checked too.
  if (url.hash !== "" || uri.includes("#")) return "a redirect URI may not have a fragment";
  if (url.username !== "" || url.password !== "") return "a redirect URI may not carry a user name or password";
  if (url.protocol === "https:" && url.hostname !== "") return null;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return null;
  return "a redirect URI must be https, or http on localhost, 127.0.0.1 or [::1]";
}
