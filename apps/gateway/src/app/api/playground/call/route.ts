import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { executeUserTool, ToolCallError } from "@/gateway/playground/tools";

// POST /api/playground/call
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  // Extract and strip the optional `account` param. executeUserTool strips
  // it again internally before calling the plugin — playground always uses
  // the user's default account for the service; the multi-account
  // limitation is accepted for v1.
  const args = { ...rawArgs };
  delete args.account;

  try {
    const { text, isError } = await executeUserTool(
      db,
      userId,
      namespacedName,
      args
    );
    return NextResponse.json({
      result: { content: [{ type: "text", text }], isError },
    });
  } catch (error) {
    if (error instanceof ToolCallError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
