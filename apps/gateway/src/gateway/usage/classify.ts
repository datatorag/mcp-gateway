export type OutcomeStatus = "success" | "user_error" | "server_error";

/** Where a tool call originated. One event carries both, as an attribute,
 * rather than two event names — see `lib/analytics.ts`. */
export type Surface = "mcp" | "agent";

export interface ClassifyInput {
  thrown: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  /** Which surface the call came through. Both meter and (SCRUM-78) both can
   * claim activation; this survives because it travels onto the event as
   * `surface`, which is what keeps the per-surface cohorts distinguishable. */
  source: Surface;
  toolName?: string;
  /** True when the tool is a gateway built-in (echo, list_connected_accounts —
   * served by this process, no plugin behind them). Built-ins EMIT tool_call
   * like every other tool; their silence was a real regression, and the silence was the
   * defect precisely because it was undocumented — a third built-in inherited
   * it by default. They never METER: the paid tier sells plugin-tool volume,
   * and a connectivity probe is not that. A flag rather than a name list here,
   * so the built-in registry in mcp-server.ts stays the single place that
   * decides what is a built-in and this file cannot drift from it. */
  builtin?: boolean;
  /** The one exception to "built-ins never meter" (SCRUM-420). A built-in
   * that moves a file through the gateway's memory is the same work a
   * plugin crossing is, and is counted as one call like it. Declared on the
   * built-in's own registry entry; absent on every other, which therefore
   * stay unmetered exactly as before. */
  meteredBuiltin?: boolean;
  /** The gateway refused the call because the provider is not connected or
   * its connection is broken (SCRUM-466): a user error that never reached a
   * provider, so it never uses the allowance. */
  notConnected?: boolean;
  /** What the plugin said about a failed call, read from the result's
   * `_meta` by `pluginFailureOf` (SCRUM-154). Absent for the gateway's own
   * refusals and for a result without the field: those stay user errors. */
  failure?: PluginFailure | null;
  /** True when the account holds every scope the gateway requests for its
   * service. A provider's insufficient-scope refusal is then for a scope we
   * never asked for, which is our failure, not the user's choice. */
  grantComplete?: boolean;
}

/** The key each plugin's `error-meta.ts` writes under. */
export const PLUGIN_ERROR_META_KEY = "datatorag.com/error";

const FAILURE_KINDS = ["http", "transient", "unreachable", "crash", "refused", "unknown_tool"] as const;

/** Mirrors `ErrorMeta` in each plugin's `error-meta.ts`. */
export type PluginFailure = {
  kind: (typeof FAILURE_KINDS)[number];
  status?: number;
  reason?: string;
};

/** The plugin's statement about a failed result, or null when it made none
 * or made one this gateway does not know. */
export function pluginFailureOf(result: unknown): PluginFailure | null {
  const meta = (result as { _meta?: Record<string, unknown> } | null)?._meta;
  const raw = meta?.[PLUGIN_ERROR_META_KEY] as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.kind as PluginFailure["kind"];
  if (!FAILURE_KINDS.includes(kind)) return null;
  return {
    kind,
    ...(Number.isInteger(raw.status) ? { status: raw.status as number } : {}),
    ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
  };
}

/** Google's reasons for a token that lacks the scope a call needs, as its two
 * error formats spell them. */
const SCOPE_REASONS = new Set(["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"]);

/** A failure on our side or the provider's, never charged to the user: an
 * upstream 5xx or 429, a request that never arrived, a plugin that broke, a
 * tool the plugin does not serve, or a scope the gateway never requests. A
 * bad argument, a declined permission, a not-found and any other provider
 * 4xx are the request's own. */
function ourFailure(input: ClassifyInput): boolean {
  const f = input.failure;
  if (!f) return false;
  switch (f.kind) {
    case "transient":
    case "unreachable":
    case "crash":
    case "unknown_tool":
      return true;
    case "http":
      if (f.status === undefined) return false;
      if (f.status === 429 || f.status >= 500) return true;
      return f.status === 403 && input.grantComplete === true && SCOPE_REASONS.has(f.reason ?? "");
    case "refused":
      return false;
  }
}

export interface ClassifyResult {
  status: OutcomeStatus;
  meter: boolean;
}

const NON_METERED_TOOLS = new Set(["gws_auth_setup", "gws_auth_refresh"]);

/* BOTH SURFACES METER, which reverses what this file used to do: the agent
 * surface returned meter:false and so wrote no usage row at all.
 *
 * The reason is pricing integrity rather than cost. The paid tier sells volume
 * and nothing else, so a surface that does not meter is a volume path that
 * does not count, which removes the only thing that tier has to sell. It cost
 * nothing while the agent was unreachable; it stops being free the moment the
 * agent is the front door.
 *
 * What did NOT change: a call we broke ourselves is still never metered, and
 * the auth tools are still never metered. A call we broke includes one the
 * plugin answered with a failure on our side (SCRUM-154, `ourFailure`). */

export function classifyOutcome(input: ClassifyInput): ClassifyResult {
  const isNonMeteredTool = input.toolName
    ? NON_METERED_TOOLS.has(input.toolName)
    : false;
  const meterable = !isNonMeteredTool && (!input.builtin || input.meteredBuiltin === true);

  if (input.thrown) {
    return { status: "server_error", meter: false };
  }
  if (input.isError) {
    if (ourFailure(input)) return { status: "server_error", meter: false };
    if (input.notConnected) return { status: "user_error", meter: false };
    return {
      status: "user_error",
      meter: meterable,
    };
  }
  return {
    status: "success",
    meter: meterable,
  };
}
