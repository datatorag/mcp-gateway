import type { CaseContext } from "./types";
import { SUBJECT_PREFIX } from "./send-guard";

/**
 * What the Slack cases share (SCRUM-454): the label every message carries
 * and the shapes the plugin answers in.
 *
 * Every write lands in the fixture channel (`slackChannel`, an id from the
 * environment) or in the test user's own DM, and carries the smoke prefix
 * and the case's stamp, which carries the run's: the send guard refuses
 * anything else. The connector has no delete, so a posted message stays in
 * the fixture channel as labelled residue; an edit is restored and a
 * reaction stays on the run's own message.
 *
 * Nothing here calls a tool. The calls stay in the case files, where the
 * declare-versus-call, argument and role checks read them.
 */

export type SlackMessage = {
  ts?: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
  permalink?: string;
};

export type SlackChannelRef = { id?: string; name?: string };

export type SlackHistory = {
  channel?: SlackChannelRef;
  messages?: SlackMessage[];
  has_more?: boolean;
  next_cursor?: string | null;
};

/** The text of something a case posts: the smoke prefix, what it is, and the
 * case's stamp. No "@" and no "<", which the guard refuses. */
export function slackLabel(ctx: CaseContext, what: string): string {
  return `${SUBJECT_PREFIX} ${what} ${ctx.stamp}`;
}

/** The ts a write answered with, or a throw saying what cannot follow. */
export function postedTs(what: string, answer: { ts?: unknown }): string {
  if (typeof answer.ts !== "string" || answer.ts === "") {
    throw new Error(`${what} answered without a ts, so the message cannot be read back`);
  }
  return answer.ts;
}

/** The message with this ts in a history or thread answer. */
export function messageAt(answer: SlackHistory, ts: string): SlackMessage | undefined {
  return (answer.messages ?? []).find((m) => m.ts === ts);
}
