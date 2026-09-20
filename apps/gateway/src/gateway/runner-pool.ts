import { ConnectionPool } from "./pool";

/**
 * The pool the NEXT side uses (SCRUM-303).
 *
 * `server.ts` owns the Express side's pool and hands it to every MCP server
 * it builds. A Next route handler is in the same process but has no route to
 * that instance, and the test runner needs one to dispatch plugin calls.
 *
 * Deliberately lazy and deliberately its own: a second pool costs a few idle
 * connections, and the alternative was exporting the Express one as module
 * state, which makes the server's startup order load-bearing for a page.
 */
let pool: ConnectionPool | null = null;

export function getPool(): ConnectionPool {
  if (!pool) pool = new ConnectionPool();
  return pool;
}
