import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withAdminRoute } from "@/lib/with-admin-route";
import { db } from "@/lib/db";
import { users } from "@datatorag-mcp/db";
import { getEnv } from "@datatorag-mcp/config";
import { parseFixtureMap } from "@/gateway/tests/fixtures";
import { visibleBuiltins, findVisibleBuiltin, BUILT_IN_TOOLS } from "@/gateway/mcp-server";

/**
 * What the runner's own tools look like to a NON-ADMIN (R2).
 *
 * It does not build a second MCP server for that user, and that is the
 * point: constructing a server as somebody else is an impersonation
 * primitive, and this case does not need one. It asks the two functions that
 * ARE the guard, `visibleBuiltins` and `findVisibleBuiltin`, for their answer
 * about that user id. Nothing here can call a plugin tool or touch that
 * user's connected accounts.
 *
 * The mapped user is validated before it is used: a uuid, role `user`, and
 * one of our own addresses. A typo in configuration must not turn this into
 * a probe against a customer.
 */
const ADMIN_TOOLS = ["tests_run", "tests_status", "tests_results"];
const UNREGISTERED = "zz_never_registered_probe";

export const GET = withAdminRoute(async () => {
  const fixtures = parseFixtureMap(getEnv().TEST_RUNNER_FIXTURES);
  const candidate = fixtures.user("nonAdmin");
  const skip = (reason: string) => NextResponse.json({ skipped: reason, listed: 0, visibleAdminTools: [], normalisedRefusals: {}, unregisteredName: UNREGISTERED });

  if (!candidate) return skip("no nonAdmin user is mapped for this run");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
    return skip("the mapped nonAdmin value is not a user id");
  }

  const [row] = await db
    .select({ id: users.id, role: users.role, email: users.email })
    .from(users)
    .where(eq(users.id, candidate))
    .limit(1);
  if (!row) return skip("the mapped nonAdmin user does not exist");
  if (row.role === "admin") return skip("the mapped nonAdmin user is an admin, so the probe would assert the opposite");
  if (!row.email.toLowerCase().endsWith("@datatorag.com")) {
    return skip("the mapped nonAdmin user is not one of our own accounts");
  }

  const listed = await visibleBuiltins(db, row.id);
  const listedNames = listed.map((t) => t.definition.name);

  const normalisedRefusals: Record<string, string> = {};
  for (const name of [...ADMIN_TOOLS, UNREGISTERED]) {
    const found = await findVisibleBuiltin(db, row.id, name);
    // `undefined` is what sends a call into the dispatch's unknown-tool
    // branch, so the refusal text is that branch's, with the echoed name
    // normalised away so the answers are directly comparable.
    normalisedRefusals[name] = found
      ? "SERVED"
      : `Unknown tool: ${JSON.stringify("NAME")}`;
  }

  return NextResponse.json({
    listed: listedNames.length,
    visibleAdminTools: ADMIN_TOOLS.filter((n) => listedNames.includes(n)),
    normalisedRefusals,
    unregisteredName: UNREGISTERED,
    registrySize: BUILT_IN_TOOLS.length,
  });
}, { logContext: "[api] admin tests non-admin probe" });
