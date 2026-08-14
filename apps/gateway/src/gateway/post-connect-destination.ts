import { resolveNextPath } from "./post-login-destination";

/**
 * Where a service-connect OAuth round trip lands, for every combination of
 * requested path and outcome.
 *
 * WHY THIS EXISTS (SCRUM-78): the agent offers a Connect control inline in the
 * conversation, and Google OAuth requires a full navigation. We chose the FULL
 * REDIRECT over a popup, deliberately:
 *
 *  - The activation this feature exists to produce happens on an external
 *    user's browser we cannot test: popup blockers, mobile Safari's
 *    popup-as-new-tab behaviour, and COOP severing `window.opener` are all
 *    environment-dependent failure modes, and a redirect has none of them.
 *  - Persistent threads (SCRUM-63) plus the validated `next` machinery
 *    (SCRUM-71) already solve "leave for Google, come back where you were";
 *    a popup path would still need this redirect path as its blocker
 *    fallback, so choosing the popup means building and maintaining both.
 *
 * The cost is one full page load on return, which thread persistence makes
 * recoverable: the conversation is rehydrated and the client continues it.
 *
 * VALIDATION IS THE SAME reject-and-fall-back discipline as the login `next`
 * (see `resolveNextPath` and `postLoginDestination`), including re-validating
 * the COMPOSED path: WHATWG dot-segment collapse can turn an accepted raw
 * value like `/..//evil.com` into the protocol-relative `//evil.com`, so the
 * output is checked again, not just the input. Rejected or absent `next`
 * falls back to the connections page, byte-identical to the pre-SCRUM-78
 * destinations.
 */
export function postConnectDestination(opts: {
  /** The RAW `next` value carried through the connect flow. Untrusted. */
  requestedPath?: unknown;
  /** Provider id, e.g. "google-workspace". Only used on success. */
  provider?: string;
  /** Error code, when the connect failed. Wins over `provider`. */
  error?: string;
}): string {
  const next = resolveNextPath(opts.requestedPath);
  if (next !== null) {
    const url = new URL(next, "http://placeholder.invalid");
    if (url.pathname.startsWith("/") && !url.pathname.startsWith("//")) {
      // Our params are authoritative: a `next` carrying its own
      // connected/connect_error must not fake a completion the flow did not
      // produce (the client auto-continues the conversation off `connected`).
      url.searchParams.delete("connected");
      url.searchParams.delete("connect_error");
      if (opts.error) {
        url.searchParams.set("connect_error", opts.error);
      } else {
        url.searchParams.set("connected", opts.provider ?? "");
      }
      return url.pathname + url.search;
    }
    // else: the composed path escaped same-origin — fall back below.
  }

  // No (valid) requested path: exactly the destinations the flow always had.
  // The error param keeps its legacy `error` name here because the
  // connections page already reads it; `connect_error` exists only on the
  // requested-path leg, where a generic `error` would be too broad to claim.
  return opts.error
    ? `/dashboard/connections?error=${encodeURIComponent(opts.error)}`
    : `/dashboard/connections?connected=${encodeURIComponent(opts.provider ?? "")}`;
}
