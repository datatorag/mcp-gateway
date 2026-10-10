import { trimExceptionMessage } from "./analytics-exceptions";

/**
 * A server-side render or route error, as it is reported (SCRUM-407).
 *
 * The browser's own capture cannot see these. When a server component
 * throws, the browser is told only that "an error occurred in the Server
 * Components render", with the message withheld; the real error exists on
 * the server and nowhere else. The Billing page failed that way for every
 * account on one plan and the only trace was that sentence in a recording.
 *
 * WHAT IS SENT: the error's name, its message trimmed (see
 * `trimExceptionMessage`: bound query values cut, length capped), its stack
 * (files, functions and line numbers, which are ours), the framework's
 * digest (the id the browser-side error carries, so the two can be joined),
 * and WHICH ROUTE, as the route's pattern. NOT the URL: a path can hold an
 * id and a query string can hold anything. Not headers, not the user.
 */

export interface RequestErrorContext {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
}

export interface ExceptionClient {
  captureException(error: unknown, distinctId?: string, properties?: Record<string, unknown>): void;
}

/** The same error with its message trimmed, in both places a message lives:
 * `message`, and the first line of `stack`, which repeats it. */
export function trimmedError(error: unknown): Error {
  const source = error instanceof Error ? error : new Error(typeof error === "string" ? error : "non-error thrown");
  const message = trimExceptionMessage(source.message);
  const trimmed = new Error(message);
  trimmed.name = source.name;
  const frames = (source.stack ?? "").split("\n").filter((line) => /^\s+at\s/.test(line));
  trimmed.stack = [`${source.name}: ${message}`, ...frames].join("\n");
  return trimmed;
}

/** How many reports one route may send in a window. A page that fails on
 * every request, or a URL somebody found that always throws, would
 * otherwise send one event per request. The first few say everything. */
export const REPORTS_PER_ROUTE = 10;
export const REPORT_WINDOW_MS = 60_000;
const MAX_TRACKED_ROUTES = 200;
const sent = new Map<string, { windowStart: number; count: number }>();

function underLimit(route: string, now: number): boolean {
  const entry = sent.get(route);
  if (!entry || now - entry.windowStart >= REPORT_WINDOW_MS) {
    // Bounded: route patterns are few, but nothing here should grow forever.
    if (!entry && sent.size >= MAX_TRACKED_ROUTES) sent.clear();
    sent.set(route, { windowStart: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= REPORTS_PER_ROUTE;
}

/** Tests only. */
export function resetRequestErrorLimit(): void {
  sent.clear();
}

export function reportRequestError(
  client: ExceptionClient | null,
  error: unknown,
  request: { method?: string },
  context: RequestErrorContext,
  now: number = Date.now()
): void {
  if (!client) return;
  if (!underLimit(context.routePath ?? "unknown", now)) return;
  try {
    const digest = (error as { digest?: unknown } | null)?.digest;
    client.captureException(trimmedError(error), undefined, {
      source: "server",
      route: context.routePath ?? null,
      route_type: context.routeType ?? null,
      render_source: context.renderSource ?? null,
      method: request.method ?? null,
      digest: typeof digest === "string" ? digest : null,
    });
  } catch {
    // Reporting an error must never be the next error.
  }
}
