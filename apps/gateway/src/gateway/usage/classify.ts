export type OutcomeStatus = "success" | "user_error" | "server_error";

/** Where a tool call originated. One event carries both, as an attribute,
 * rather than two event names — see `lib/analytics.ts`. */
export type Surface = "mcp" | "agent";

export interface ClassifyInput {
  thrown: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  /** Which surface the call came through. Both meter; this survives because
   * it travels onto the event as `surface` and because the activation
   * milestone still only counts real gateway traffic. */
  source: Surface;
  toolName?: string;
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
 * the auth tools are still never metered. */

export function classifyOutcome(input: ClassifyInput): ClassifyResult {
  const isNonMeteredTool = input.toolName
    ? NON_METERED_TOOLS.has(input.toolName)
    : false;

  if (input.thrown) {
    return { status: "server_error", meter: false };
  }
  if (input.isError) {
    return {
      status: "user_error",
      meter: !isNonMeteredTool,
    };
  }
  return {
    status: "success",
    meter: !isNonMeteredTool,
  };
}
