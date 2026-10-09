import type { AtlassianClient } from "../atlassian-client.js";
import { jiraTools, handleJira } from "./jira.js";
import { confluenceTools, handleConfluence } from "./confluence.js";

export type ToolHandler = (
  client: AtlassianClient,
  name: string,
  args: Record<string, unknown>
) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;

export const allTools = [...jiraTools, ...confluenceTools];

function register(
  toolDefs: ReadonlyArray<{ readonly name: string }>,
  handler: ToolHandler
): Array<[string, ToolHandler]> {
  return toolDefs.map((t) => [t.name, handler]);
}

export const toolHandlers = new Map<string, ToolHandler>([
  ...register(jiraTools, handleJira),
  ...register(confluenceTools, handleConfluence),
]);
