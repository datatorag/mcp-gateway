import type { Processor } from "@mastra/core/processors";
import type { RequestContext } from "@mastra/core/request-context";

import { stopRequested } from "@/gateway/playground/run-registry";
import { RUN_ID_CONTEXT_KEY } from "./llm-usage";

/**
 * The user's Stop (SCRUM-258), honoured at the next step boundary.
 *
 * A dropped connection does not stop a run (SCRUM-254), and before this a
 * pressed Stop looked exactly like one, so a stopped morning brief still
 * labelled, filed and mailed. Now Stop is a request keyed by the run id,
 * recorded by the stop endpoint, and this processor reads it before each
 * model call. When it is set the step is aborted: the runtime turns that
 * into a tripwire and ends the run. The previous step's tool calls have
 * already finished by the time a step processor runs, so nothing is cut
 * mid-write, and no further model call starts.
 *
 * First in the processor chain, so a stopped run neither gets the closing
 * instruction nor a cache mark it will never send.
 */

export const STOP_REASON = "stopped by user";

function read(context: RequestContext | undefined, key: string): string | undefined {
  const value = context?.get(key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// `satisfies`, not a type annotation, for the same reason as the sibling
// processors: the agent's processor slot requires the step hook on the type.
export const userStop = {
  id: "user-stop",
  processInputStep({
    messages,
    requestContext,
    abort,
  }: {
    messages: unknown[];
    requestContext?: RequestContext;
    abort: (reason?: string) => never;
  }) {
    const runId = read(requestContext, RUN_ID_CONTEXT_KEY);
    if (runId && stopRequested(runId)) abort(STOP_REASON);
    return { messages: messages as never };
  },
} satisfies Processor;
