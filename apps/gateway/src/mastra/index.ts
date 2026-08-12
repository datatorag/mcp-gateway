import { Mastra } from "@mastra/core/mastra";
import { PostgresStore } from "@mastra/pg";
import { getEnv } from "@datatorag-mcp/config";
import { createDatatoragAgent, DATATORAG_AGENT_ID } from "./agents/datatorag";
import { resolveUserPluginTools } from "./mcp/client";

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
 * string — pays for a validated connection config it may never use.
 *
 * The connection string comes from the validated config rather than straight
 * off `process.env`: the schema requires a URL, so a missing or malformed one
 * fails as a configuration error instead of arriving here as an empty string
 * that the store then rejects as a connection problem. */
let store: PostgresStore | undefined;

function getStore(): PostgresStore {
  if (!store) {
    store = new PostgresStore({
      id: "playground-agent-store",
      connectionString: getEnv().DATABASE_URL,
    });
  }
  return store;
}

/** The memory storage domain, for reading conversations back out.
 *
 * Exported for the thread gate in `gateway/playground/threads.ts` and for
 * nothing else. It shares the memoised store above deliberately: one instance,
 * one pool, same connection the agent writes through, so a read can never
 * disagree with a write by talking to a different place.
 *
 * DO NOT REACH FOR THIS FROM A ROUTE. Every thread read and every delete goes
 * through the gate, because one of the methods behind here takes no owner and
 * will happily delete another user's conversation if asked politely. The gate
 * is where that is prevented, once. */
export async function getMemoryStore() {
  return getStore().getStore("memory");
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
      agents: {
        // This module is the composition root: it is the only place that knows
        // both how the agent is built and where its tools really come from.
        [DATATORAG_AGENT_ID]: createDatatoragAgent(storage, resolveUserPluginTools),
      },
    });
  }
  return instance;
}

export { DATATORAG_AGENT_ID };
