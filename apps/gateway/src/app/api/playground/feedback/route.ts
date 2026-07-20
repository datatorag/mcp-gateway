import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { trackPlaygroundFeedback } from "@/gateway/track";

const MAX_COMMENT_LENGTH = 2000;

type FeedbackBody = {
  rating?: unknown;
  comment?: unknown;
  prompt?: unknown;
};

// POST /api/playground/feedback — thumbs up/down capture for a playground
// turn. Never blocks on Slack/PostHog side effects taking too long; those
// live inside trackPlaygroundFeedback.
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as FeedbackBody | null;
  const rating = body?.rating;
  if (rating !== "up" && rating !== "down") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const comment =
    typeof body?.comment === "string"
      ? body.comment.slice(0, MAX_COMMENT_LENGTH)
      : undefined;
  const prompt = typeof body?.prompt === "string" ? body.prompt : undefined;

  await trackPlaygroundFeedback(db, userId, rating, comment, prompt);

  return NextResponse.json({ ok: true });
}
