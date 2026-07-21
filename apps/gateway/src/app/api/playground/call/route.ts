import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { executeUserTool, ToolCallError } from "@/gateway/playground/tools";
import { logAndGenericError } from "@/lib/errors";

// POST /api/playground/call
export const POST = withRoute(async (userId, request) => {
  const body = (await request.json()) as {
    tool: string;
    arguments?: Record<string, unknown>;
  };

  const { tool: namespacedName, arguments: rawArgs = {} } = body;

  if (!namespacedName) {
    return NextResponse.json(
      { error: "Missing tool parameter" },
      { status: 400 }
    );
  }

  try {
    // executeUserTool strips any `account` arg — playground always uses the
    // user's default account for the service (v1 limitation).
    const { text, isError } = await executeUserTool(
      db,
      userId,
      namespacedName,
      rawArgs
    );
    return NextResponse.json({
      result: { content: [{ type: "text", text }], isError },
    });
  } catch (error) {
    if (error instanceof ToolCallError) {
      // ToolCallError carries a deliberately client-safe message + status.
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    // Unknown failure — log the real error, never leak internals to the client.
    return NextResponse.json(
      { error: logAndGenericError("[playground] tool call failed", error) },
      { status: 500 }
    );
  }
});
