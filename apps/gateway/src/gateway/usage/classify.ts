export type OutcomeStatus = "success" | "user_error" | "server_error";

export interface ClassifyInput {
  thrown: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  source: "mcp" | "playground";
  toolName?: string;
}

export interface ClassifyResult {
  status: OutcomeStatus;
  meter: boolean;
}

const NON_METERED_TOOLS = new Set(["gws_auth_setup", "gws_auth_refresh"]);

export function classifyOutcome(input: ClassifyInput): ClassifyResult {
  const isPlayground = input.source === "playground";
  const isNonMeteredTool = input.toolName
    ? NON_METERED_TOOLS.has(input.toolName)
    : false;

  if (input.thrown) {
    return { status: "server_error", meter: false };
  }
  if (input.isError) {
    return {
      status: "user_error",
      meter: !isPlayground && !isNonMeteredTool,
    };
  }
  return {
    status: "success",
    meter: !isPlayground && !isNonMeteredTool,
  };
}
