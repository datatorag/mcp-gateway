import type { PostHogClient } from "../posthog-client.js";
import type { ToolDef } from "./annotations.js";
import { handlePostHogRead, posthogReadTools } from "./posthog-read.js";

export type ToolHandler = (
  client: PostHogClient,
  name: string,
  args: Record<string, unknown>
) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;

export const allTools: ToolDef[] = [...posthogReadTools];

export const toolHandlers = new Map<string, ToolHandler>(posthogReadTools.map((t) => [t.name, handlePostHogRead]));
