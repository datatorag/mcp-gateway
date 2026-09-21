import { NextResponse, type NextRequest } from "next/server";
import { withAdminRoute } from "@/lib/with-admin-route";
import { classifyWrite } from "@/gateway/playground/tools";
import { BUILT_IN_TOOLS } from "@/gateway/mcp-server";

/**
 * How the approval gate classifies named tools (F1).
 *
 * The runner asks rather than importing the classifier itself, on purpose:
 * a case that imported `classifyWrite` would be asserting that a function
 * agrees with itself. Going through the running gateway means the answer is
 * the one a caller actually gets.
 */
export const GET = withAdminRoute(async (_userId, req: NextRequest) => {
  const asked = (new URL(req.url).searchParams.get("tools") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 50);

  const classification: Record<string, boolean> = {};
  for (const name of asked) {
    const builtin = BUILT_IN_TOOLS.find((t) => t.definition.name === name);
    classification[name] = builtin ? builtin.approval === "write" : classifyWrite(name);
  }
  return NextResponse.json({ classification });
}, { logContext: "[api] admin tests classification" });
