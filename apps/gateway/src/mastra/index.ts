import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { createDatatoragAgent, DATATORAG_AGENT_ID } from "./agents/datatorag";

/** The agent runtime for the dashboard playground.
 *
 * Scope: this module owns the playground's agent loop and nothing else. The
 * gateway's own MCP server, OAuth, plugin supervision, metering and session
 * handling are unaffected by anything in this directory.
 */

/** Postgres store backing agent state. Points at the same database the rest of
 * the app uses; the framework keeps its own `mastra_*` tables, so it is purely
 * additive to our schema and needs no migration of ours.
 *
 * Constructed lazily and memoised. Doing it at module scope would mean every
 * importer — including a production build with a placeholder connection
 * string — pays for a validated connection config it may never use. */
let store: PostgresStore | undefined;

function getStore(): PostgresStore {
  if (!store) {
    store = new PostgresStore({
      id: "playground-agent-store",
      connectionString: process.env.DATABASE_URL ?? "",
    });
  }
  return store;
}

/** The single Mastra instance for this process.
 *
 * IMPORTANT: `storage` is set HERE, on the runtime, not only on the agent's
 * `Memory`. Both need it and they are not the same thing. Memory's store holds
 * the conversation; the runtime's store holds run state — which is what a
 * suspended run (an agent waiting on a human decision) is written to and read
 * back from. Configure it on `Memory` alone and everything looks healthy:
 * chats persist, the runtime reports that it has storage, runs suspend. Then
 * resuming fails because the snapshot was never written anywhere. Both point
 * at the same store instance, so this costs one shared pool, not two. */
let instance: Mastra | undefined;

export function getMastra(): Mastra {
  if (!instance) {
    const storage = getStore();
    instance = new Mastra({
      storage,
      agents: { [DATATORAG_AGENT_ID]: createDatatoragAgent(storage) },
    });
  }
  return instance;
}

export { DATATORAG_AGENT_ID };
