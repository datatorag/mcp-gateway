/**
 * `ctx.http` (SCRUM-303): the only way a case reaches an HTTP surface, and
 * it cannot leave this machine.
 *
 * It exists for the handful of cases that are about the FRONT DOOR rather
 * than about a tool: `/health`, the metadata documents, the 401 an
 * unauthenticated `/mcp` gives. Those cannot be asked through the in-process
 * client, because the in-process client is exactly the thing that skips the
 * HTTP layer.
 *
 * A case supplies a PATH, never a URL. Everything else is refused rather
 * than normalised: a helper that quietly repairs `//evil.example` into
 * something local is a helper nobody can reason about. After building, the
 * origin is compared again, so a path that survives the string checks and
 * still lands somewhere else fails.
 */

export type HttpFetcher = (path: string, init?: RequestInit) => Promise<Response>;

export function loopbackBase(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** Exported for its own test: the string rules, with no network. */
export function buildLoopbackUrl(base: string, path: string): URL {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("ctx.http: needs a path");
  }
  // Exactly one leading slash. `//host` is a protocol-relative URL and would
  // resolve against the base's SCHEME rather than its host, so it leaves the
  // machine while looking like a path.
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(
      `ctx.http: needs a path starting with a single "/", got ${JSON.stringify(path.slice(0, 40))}`
    );
  }
  // A backslash is a slash to some URL parsers and not to others, which is
  // the whole trick; refuse it rather than pick a side.
  if (path.includes("\\")) {
    throw new Error("ctx.http: a path may not contain a backslash");
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error("ctx.http: a path may not contain control characters");
  }

  const url = new URL(path, base);
  // A BACKSTOP WITH NO REACHABLE INPUT, and that is stated rather than left
  // for someone to discover. Given the string rules above, `new URL(path,
  // base)` always keeps the base's origin, so no input this function accepts
  // can trip this branch, and a mutation that deletes it turns nothing red.
  // It stays because the string rules encode assumptions about a URL parser
  // that is not ours and does change: the day one of them stops holding,
  // this is what fails instead of a request leaving the machine. Do not
  // "cover" it with a test that reaches in and fakes a base.
  if (url.origin !== new URL(base).origin) {
    throw new Error(`ctx.http: refusing an off-origin URL (${url.origin})`);
  }
  return url;
}

/**
 * Sends no credential of its own, because its cases are the anonymous ones.
 * Follows no redirect: a 302 is an answer to assert about, and following one
 * is how a loopback probe ends up somewhere else.
 */
export function createHttpFetcher(base: string, fetchImpl: typeof fetch = fetch): HttpFetcher {
  return async (path, init) => {
    const url = buildLoopbackUrl(base, path);
    return fetchImpl(url, { ...init, redirect: "manual" });
  };
}
