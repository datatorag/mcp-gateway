import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
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
export const POST = withRoute(async (userId, request) => {
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
});
