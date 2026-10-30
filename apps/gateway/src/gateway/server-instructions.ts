/**
 * The instructions an MCP client is given at initialize (SCRUM-466): what
 * the tools are, that each provider needs its account connected, and that
 * `connect` comes first. The same for every client; nothing found gives a
 * reason to vary them, and one text is one thing to keep true. Not given on
 * the dashboard agent's surface, which has its own system prompt.
 */
import { CONNECTABLE_SERVICES, offeredServices } from "../app/dashboard/connections/service-registry";
import { CONNECT_TOOL, listOf } from "./connect-tool";

/** The three lines, naming only the providers that have launched. */
export function serverInstructions(launched: Iterable<string>): string {
  const names = offeredServices(CONNECTABLE_SERVICES, launched).map((s) => s.name);
  return [
    `DataToRAG gives you tools for the user's ${listOf(names)}.`,
    "Each provider's tools need that account connected first; until then they are not listed.",
    `Call \`${CONNECT_TOOL}\` first to see what is connected and to get a link for anything that is not.`,
  ].join("\n");
}
