import { METHOD_TABLE, type MethodEntry } from "./method-table.js";

/** One Google API request, fully resolved but not yet sent.
 *
 * `queryParams` is a sorted list of pairs rather than a URLSearchParams so the
 * oracle test can compare it to the pinned CLI's `--dry-run` output, which
 * reports the same shape. The URL carries no query string for the same
 * reason; `requestUrl` joins them for the wire. */
export interface BuiltRequest {
  method: string;
  url: string;
  queryParams: Array<[string, string]>;
  body: unknown;
  isUpload: boolean;
  entry: MethodEntry;
}

export class UnknownMethodError extends Error {
  constructor(message: string) {
    // Same text class the CLI transport produced for an unknown resource or
    // method (its exit code 4), so callers and the model read the same thing.
    super(`API discovery error: ${message}`);
    this.name = "UnknownMethodError";
  }
}

function lookup(service: string, resource: string, method: string): { root: string; entry: MethodEntry } {
  const svc = Object.hasOwn(METHOD_TABLE, service) ? METHOD_TABLE[service] : undefined;
  if (!svc) {
    throw new UnknownMethodError(
      `unknown service "${service}". Known services: ${Object.keys(METHOD_TABLE).join(", ")}.`
    );
  }
  const key = `${resource}.${method}`;
  const entry = Object.hasOwn(svc.methods, key) ? svc.methods[key] : undefined;
  if (!entry) {
    const siblings = Object.keys(svc.methods)
      .filter((k) => k.startsWith(`${resource}.`))
      .map((k) => k.slice(resource.length + 1));
    throw new UnknownMethodError(
      siblings.length > 0
        ? `${service} ${resource} has no method "${method}". Methods: ${siblings.join(", ")}.`
        : `${service} has no resource "${resource}". Resources nest under their parent, e.g. "users.messages", not "messages".`
    );
  }
  return { root: `${svc.rootUrl}${svc.servicePath}`, entry };
}

/** The two path forms Discovery uses: `{name}` is one segment, `{+name}`
 * keeps its slashes so a resource name like `people/c123` stays a path.
 *
 * Everything that is not an ASCII letter or digit is percent-encoded,
 * including `-`, `.`, `_` and `~`. That is stricter than RFC 3986 requires,
 * and deliberate: it is byte for byte what the CLI transport sent for every
 * id this plugin has ever addressed (Drive ids are full of `-` and `_`), so
 * the wire form known to work is the one that keeps going out. The oracle
 * test holds this against the pinned CLI. */
const encodeSegment = (value: string) =>
  Array.from(Buffer.from(value, "utf8"))
    .map((b) =>
      (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a)
        ? String.fromCharCode(b)
        : `%${b.toString(16).toUpperCase().padStart(2, "0")}`
    )
    .join("");
const encodeReserved = (value: string) => value.split("/").map(encodeSegment).join("/");

function scalar(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Whether Discovery marks the method as a media download (`alt=media`). */
export function supportsMediaDownload(service: string, resource: string, method: string): boolean {
  return lookup(service, resource, method).entry.mediaDownload === true;
}

export function buildRequest(
  service: string,
  resource: string,
  method: string,
  options?: { params?: Record<string, unknown>; jsonBody?: unknown; upload?: boolean }
): BuiltRequest {
  const { root, entry } = lookup(service, resource, method);
  const params = options?.params ?? {};

  let template = entry.path;
  if (options?.upload) {
    const simple = entry.mediaUpload?.simple;
    if (!simple) throw new UnknownMethodError(`${service} ${resource} ${method} does not accept media.`);
    template = simple.replace(/^\//, "");
  }
  const path = template.replace(/\{(\+?)([^}]+)\}/g, (_, plus: string, name: string) => {
    const value = params[name];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Validation error: missing required path parameter "${name}" for ${service} ${resource} ${method}.`);
    }
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`Validation error: path parameter "${name}" must be a string or a number.`);
    }
    // An empty segment in a slash-keeping value ("a//b", a leading or
    // trailing slash) names nothing; refused so the path sent is the path meant.
    if (plus && String(value).split("/").includes("")) {
      throw new Error(`Validation error: path parameter "${name}" must not contain an empty segment.`);
    }
    // A dot segment is refused, not encoded. `.` goes out as %2E, and URL
    // parsing treats %2E%2E exactly like `..`, so an id of "../../x" would
    // leave this method's path for another on the same host, under a tool
    // name that says otherwise. No real id is a dot segment.
    if (String(value).split("/").some((segment) => segment === "." || segment === "..")) {
      throw new Error(`Validation error: path parameter "${name}" must not contain a "." or ".." segment.`);
    }
    return plus ? encodeReserved(String(value)) : encodeSegment(String(value));
  });
  // An upload path is rooted at the host, not at the service path.
  const base = options?.upload ? new URL(root).origin + "/" : root;

  const inPath = new Set(entry.pathParams);
  const repeated = new Set(entry.repeated);
  const queryParams: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(params)) {
    if (inPath.has(key) || value === undefined) continue;
    if (Array.isArray(value) && repeated.has(key)) {
      // A repeated parameter goes out as a repeated key (ranges=A&ranges=B).
      for (const element of value) queryParams.push([key, scalar(element)]);
    } else {
      queryParams.push([key, scalar(value)]);
    }
  }
  queryParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  // Belt to the braces above: whatever was built must parse back to itself.
  const built = `${base}${path}`;
  if (new URL(built).href !== built) {
    throw new Error(`Validation error: ${service} ${resource} ${method} built a path that does not survive URL parsing.`);
  }

  return {
    method: entry.httpMethod,
    url: built,
    queryParams,
    body: options?.jsonBody ?? null,
    isUpload: options?.upload === true,
    entry,
  };
}

export function requestUrl(request: BuiltRequest, extra: Array<[string, string]> = []): string {
  const query = new URLSearchParams([...request.queryParams, ...extra]).toString();
  return query ? `${request.url}?${query}` : request.url;
}
