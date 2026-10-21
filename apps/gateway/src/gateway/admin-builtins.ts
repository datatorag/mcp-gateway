/**
 * The built-in tools only an admin is served: the test runner's own
 * (SCRUM-303). `BUILT_IN_TOOLS` in `mcp-server.ts` marks them with
 * `audience: "admin"`, and `visibleBuiltins` hides them from everyone else.
 *
 * The names are repeated here, in a module with no imports, so a public page
 * can leave them out without importing the MCP server (SCRUM-431).
 * `admin-builtins.test.ts` holds this list equal to the entries that declare
 * the audience, so the two cannot drift.
 */
export const ADMIN_ONLY_BUILTINS: readonly string[] = ["tests_run", "tests_status", "tests_results"];
