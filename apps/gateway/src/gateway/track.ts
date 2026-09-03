import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import { EVENTS, type ProviderId } from "../lib/analytics";
import {
  acquisitionProps,
  acquisitionSetOnce,
  sessionProps,
  type Attribution,
} from "../lib/attribution";
import { getPosthog, shutdownPosthog } from "../lib/posthog-server";
import { sendSlack } from "../lib/slack";
import { writeUsageEvent } from "./usage/write";
import { redactErrorMessage } from "./usage/redact";
import { classifyOutcome, type ClassifyInput } from "./usage/classify";
import { countToolCall, periodStatus } from "./usage/period";
import {
  resolveUserIdentity,
  resolveUserEmail,
  markUserActivated,
  identityProps,
} from "./user-email";

export { shutdownPosthog };

export async function trackToolCall(
  db: Database,
  props: {
    userId: string;
    toolName: string;
    connectorType: string | null;
    accountEmail: string | undefined;
    latencyMs: number;
    responseSizeBytes: number | null;
    errorMessage: string | null;
    outcome: ClassifyInput;
    /** The agent run this call belongs to, when it belongs to one. Null for
     * gateway traffic, which has no run. Carrying it is what lets one join
     * answer both how many tools a run used and what that run cost, which are
     * otherwise in two event streams with nothing in common. */
    runId?: string | null;
    /** Client identity (SCRUM-189): provenance as PROPERTIES of the one
     * event, never a second event or a second count. clientId is the OAuth
     * client id the session authenticated with — ours and stable, but it
     * identifies a REGISTRATION (dynamic registration mints a fresh id per
     * register call). clientName is self-reported at the MCP initialize
     * handshake and drifts across versions. Both, because each answers a
     * question the other cannot. Rows from before these existed have neither;
     * that cliff is a missing join key, not a drop in usage. */
    clientId?: string | null;
    clientName?: string | null;
  }
): Promise<void> {
  // Metering + analytics run fire-and-forget off the tool-response path (see the
  // call sites in mcp-server.ts) so the identity lookup and sinks never add
  // latency to the tool call. Because it's not awaited, this must never reject —
  // a floating rejection would surface as an unhandled rejection. Everything is
  // best-effort: on any failure we log and move on.
  try {
    const { status, meter } = classifyOutcome(props.outcome);
    // One message, two sinks, opposite rules (SCRUM-200). PostHog is a
    // third-party processor: an error can quote the text a tool choked on, and
    // that must not leave our systems, so the capture below gets the scrubbed
    // value. Our own usage_events row is user-scoped and shown back only to
    // the person whose call it was, who already received the whole error live
    // from the tool response (nothing on that path redacts). Censoring their
    // own copy made failed calls undiagnosable, so writeUsageEvent gets the
    // raw message, capped for size there. Never route props.errorMessage to
    // capture(); the redacted value is the only one that may leave.
    const redactedErrorMessage = redactErrorMessage(props.errorMessage);
    const c = getPosthog();
    const identity = await resolveUserIdentity(db, props.userId);
    const userEmail = identity?.email ?? null;
    if (c) {
      c.capture({
        distinctId: props.userId,
        event: EVENTS.TOOL_CALL,
        properties: {
          tool_name: props.toolName,
          connector_type: props.connectorType,
          account_email: props.accountEmail ?? null,
          status,
          latency_ms: props.latencyMs,
          response_size_bytes: props.responseSizeBytes,
          error_message: redactedErrorMessage,
          metered: meter,
          surface: props.outcome.source,
          run_id: props.runId ?? null,
          client_id: props.clientId ?? null,
          client_name: props.clientName ?? null,
          ...identityProps(userEmail),
        },
      });
    }

    // Activation milestone: a real (non-builtin) tool call succeeded on the
    // user's own data, on EITHER surface.
    //
    // THE SURFACE GATE WAS WIDENED DELIBERATELY (SCRUM-78). It used to count
    // only `mcp`, on the reading that activation meant "the user's own MCP
    // client can reach us" — and under that reading the metric was
    // structurally blind to the funnel the product actually has: the agent is
    // the front door, a user whose agent reads their own mailbox has plainly
    // gotten value from their own data, and the inline-connect flow built to
    // produce exactly that outcome could never have moved the number it is
    // measured by. Widening also fixes what keys off the flag: the
    // no-activation follow-up email must not nag a user whose agent already
    // did real work for them. The event carries `surface`, so the narrower
    // "own MCP client connected" cohort remains a filter away.
    //
    // Skipped once the cache knows the user is activated, so the per-call
    // claim UPDATE runs at most once per user per process.
    //
    // Built-ins stay excluded (SCRUM-66): an `echo` proves the client can
    // reach us, not that the user got value from a real tool. Introspection
    // tools never reach this function at all, so an agent turn that merely
    // offered a connect control cannot claim activation either — only a real
    // plugin tool call can.
    if (
      status === "success" &&
      !props.outcome.builtin &&
      !identity?.activated
    ) {
      await trackFirstToolCall(
        db,
        props.userId,
        props.toolName,
        props.connectorType,
        props.outcome.source,
        userEmail
      );
    }

    if (!meter) return;

    // The allowance counter, incremented for every metered call whatever
    // surface it came through. Unguarded: the call already happened, so the
    // only thing refusing to count could achieve is losing the count. Whether
    // the NEXT one is allowed is decided before dispatch.
    // Concurrent, not sequential: the counter is an UPDATE on `users` and the
    // event is an INSERT into `usage_events`, with no data dependency either
    // way and independent failure handling. Awaiting them in series doubled
    // the time this held a connection on the tail of every metered call, and
    // this path now runs for the agent surface too.
    await Promise.all([
      countToolCall(db, props.userId).catch((err) =>
        console.warn(`[usage] counter increment failed for user=${props.userId}`, err)
      ),
      writeUsageEvent(db, {
        userId: props.userId,
        toolName: props.toolName,
        connector: props.connectorType,
        accountEmail: props.accountEmail ?? null,
        status,
        latencyMs: props.latencyMs,
        responseSizeBytes: props.responseSizeBytes,
        errorMessage: props.errorMessage,
      }).then((result) => {
        if (!result.ok) {
          console.warn(
            `[usage] write failed (${result.reason}) for user=${props.userId} tool=${props.toolName}`
          );
        }
      }),
    ]);
  } catch (err) {
    console.warn(
      `[track] tool_call tracking failed for user=${props.userId} tool=${props.toolName}`,
      err
    );
  }
}

/**
 * Claim the user's first-successful-tool-call milestone. The UPDATE ... WHERE
 * first_tool_call_at IS NULL is the idempotency guard: exactly one call ever
 * gets a row back, so the first_tool_call event fires once per user even
 * under concurrent tool calls. Never throws — the milestone must not break
 * the tool-call path.
 */
async function trackFirstToolCall(
  db: Database,
  userId: string,
  toolName: string,
  connectorType: string | null,
  surface: string,
  userEmail: string | null
): Promise<void> {
  try {
    const claimed = await db
      .update(users)
      .set({ firstToolCallAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.firstToolCallAt)))
      .returning({ id: users.id });
    // The claim ran, so first_tool_call_at is now non-null either way.
    markUserActivated(userId);
    if (claimed.length === 0) return;
    const c = getPosthog();
    if (!c) return;
    c.capture({
      distinctId: userId,
      event: EVENTS.FIRST_TOOL_CALL,
      properties: {
        tool_name: toolName,
        connector_type: connectorType,
        // Which surface activated this user (SCRUM-78 widened the claim to
        // both), so the old "own MCP client" cohort stays one filter away.
        surface,
        ...identityProps(userEmail),
      },
    });
  } catch (err) {
    console.warn(
      `[track] first_tool_call milestone failed for user=${userId}`,
      err
    );
  }
}

// The #leads Slack post for signups lives in signup-alert.ts (notifySignup),
// which adds lead-match + attribution and skips internal accounts — this
// function is PostHog-only (SCRUM-26 moved the Slack line out).
/**
 * `attribution` is the browser snapshot handed to the signup redirect. It is
 * what makes this event attributable at all: a server-side capture carries no
 * session id of its own, so without it the signup cannot be joined to the
 * browsing session — and therefore to the channel — that produced it.
 */
export function trackSignup(
  userId: string,
  email: string,
  name: string | null,
  attribution?: Attribution | null
): void {
  const c = getPosthog();
  if (!c) return;
  c.identify({
    distinctId: userId,
    properties: { email, name: name ?? undefined, ...acquisitionProps(attribution) },
  });
  c.capture({
    distinctId: userId,
    event: EVENTS.USER_SIGNED_UP,
    properties: {
      email,
      ...identityProps(email),
      ...sessionProps(attribution),
      ...acquisitionProps(attribution),
      ...acquisitionSetOnce(attribution),
    },
  });
}

export function trackLogin(
  userId: string,
  email: string,
  attribution?: Attribution | null
): void {
  const c = getPosthog();
  if (!c) return;
  c.capture({
    distinctId: userId,
    event: EVENTS.USER_LOGGED_IN,
    properties: { ...identityProps(email), ...sessionProps(attribution) },
  });
}

/**
 * Agent chat analytics. Never throws: a capture failure must not break the
 * streaming chat response.
 *
 * These sit alongside `trackToolCall` rather than replacing it. The agent's
 * TOOL CALLS go through that, as `tool_call` with `surface: "agent"`, because
 * they are the same measurement as gateway traffic and now meter the same way.
 * What is left here is the surface's own lifecycle, which has no gateway
 * equivalent.
 */
async function capturePlaygroundEvent(
  db: Database,
  userId: string,
  event: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  try {
    const c = getPosthog();
    if (!c) return;
    const identity = await resolveUserIdentity(db, userId);
    c.capture({
      distinctId: userId,
      event,
      properties: { ...properties, ...identityProps(identity?.email ?? null) },
    });
  } catch (err) {
    console.warn(`[track] ${event} failed for user=${userId}`, err);
  }
}

export async function trackPlaygroundMessage(
  db: Database,
  userId: string
): Promise<void> {
  return capturePlaygroundEvent(db, userId, EVENTS.PLAYGROUND_MESSAGE_SENT);
}

/** One agent turn, emitted where the run id is minted.
 *
 * SERVER-SIDE, which is a move rather than a rename. The client-side event
 * this replaces fired only from one set of buttons, so ordinary turns and the
 * in-thread suggestions were invisible and the run count was an undercount of
 * unknown size. Here it fires for every turn, and it is the only place that
 * can attach the run id the tool calls and the token events also carry. */
export async function trackAgentRun(
  db: Database,
  userId: string,
  props: { runId: string; runsUsed: number }
): Promise<void> {
  // Activation for the agent surface, claimed the same idempotent way as the
  // gateway's: UPDATE ... WHERE the column IS NULL, so exactly one concurrent
  // run ever gets a row back and the milestone fires once per user.
  //
  // A SEPARATE MARKER FROM first_tool_call_at, deliberately. That one means "a
  // real MCP client called through the gateway" and the no-activation email and
  // the digest both key off that meaning; widening it here would change what
  // those already report without touching their code.
  void claimFirstAgentRun(db, userId);
  return capturePlaygroundEvent(db, userId, EVENTS.AGENT_RUN, {
    run_id: props.runId,
    runs_used: props.runsUsed,
  });
}

/** Claim the user's first-agent-run milestone. Never throws: a milestone must
 * not be able to break the turn it is observing. */
async function claimFirstAgentRun(db: Database, userId: string): Promise<void> {
  try {
    const claimed = await db
      .update(users)
      .set({ firstAgentRunAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.firstAgentRunAt)))
      .returning({ id: users.id });
    if (claimed.length === 0) return;
    const c = getPosthog();
    if (!c) return;
    c.capture({
      distinctId: userId,
      event: EVENTS.FIRST_AGENT_RUN,
      properties: { ...identityProps(await resolveUserEmail(db, userId)) },
    });
  } catch (err) {
    console.warn(`[track] first_agent_run milestone failed for user=${userId}`, err);
  }
}

export async function trackPlaygroundCapHit(
  db: Database,
  userId: string
): Promise<void> {
  return capturePlaygroundEvent(db, userId, EVENTS.PLAYGROUND_CAP_HIT);
}

/** The in-thread connect ask reached its decision point (SCRUM-112). Fired
 * from `request_connection`'s execute, once per ask, whichever branch ran —
 * see the event's doc in `lib/analytics.ts` for why this is server-side and
 * what each `outcome` means.
 *
 * The first-run derivation lives HERE, behind this function's never-throw
 * contract, so the tool's branches stay a single fire-and-forget call and a
 * telemetry read can never break the ask it is observing. `first_agent_run`
 * means the account's first run EVER: the run claim has already stamped
 * `firstAgentRunAt` by the time any tool executes, so on the true first turn
 * that stamp is fresh and this period's run count is 1; a later period's
 * first run has count 1 but an old stamp, and both facts travel so the
 * derivation can be re-checked from the raw event. */
export async function trackConnectCardShown(
  db: Database,
  userId: string,
  props: {
    service: string;
    /** `reconsent_shown` (SCRUM-136, additive): the card was placed for a
     * connected-but-short grant — a reconnect ask, not a first connect. */
    outcome: "shown" | "already_connected" | "no_writer" | "reconsent_shown";
  }
): Promise<void> {
  try {
    const status = await periodStatus(db, userId);
    const [row] = await db
      .select({ firstAgentRunAt: users.firstAgentRunAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const runs = status?.agentRuns ?? 0;
    const periodStart = status?.periodStart
      ? new Date(status.periodStart)
      : null;
    const firstAt = row?.firstAgentRunAt ?? null;
    const firstAgentRun =
      runs <= 1 &&
      firstAt !== null &&
      (periodStart === null || firstAt >= periodStart);
    return capturePlaygroundEvent(db, userId, EVENTS.CONNECT_CARD_SHOWN, {
      service: props.service,
      outcome: props.outcome,
      first_agent_run: firstAgentRun,
      agent_runs_this_period: runs,
    });
  } catch (err) {
    console.warn(`[track] connect_card_shown failed for user=${userId}`, err);
  }
}

/** A run stopped at the per-run token ceiling (SCRUM-84). Separate from
 * `playground_cap_hit`, which is the RUN allowance refusing a new run; this
 * is one run's SIZE bound stopping its next step. Summing them as one series
 * would blur two different product walls. */
export async function trackPlaygroundRunCeilingHit(
  db: Database,
  userId: string
): Promise<void> {
  return capturePlaygroundEvent(db, userId, EVENTS.PLAYGROUND_RUN_CEILING_HIT);
}

/** Write-confirmation gate: "shown" when a turn pauses for approval,
 * "approved"/"denied" on the user's decision. `writeCount` = pending writes. */
export async function trackPlaygroundConfirm(
  db: Database,
  userId: string,
  kind: "shown" | "approved" | "denied",
  writeCount: number
): Promise<void> {
  return capturePlaygroundEvent(db, userId, EVENTS.PLAYGROUND_CONFIRM, {
    kind,
    write_count: writeCount,
  });
}

/**
 * Playground thumbs up/down feedback — PostHog capture for analytics plus a
 * Slack ping to #feedback so a human sees it right away. The Slack post is
 * fire-and-forget (never awaited) so a slow/unreachable Slack API never
 * delays the response; the PostHog capture is best-effort and never throws.
 */
export async function trackPlaygroundFeedback(
  db: Database,
  userId: string,
  rating: "up" | "down",
  comment?: string,
  prompt?: string
): Promise<void> {
  const identity = await resolveUserIdentity(db, userId);
  const email = identity?.email ?? null;

  try {
    const c = getPosthog();
    if (c) {
      c.capture({
        distinctId: userId,
        event: EVENTS.PLAYGROUND_FEEDBACK,
        // BEHAVIOUR AND AUTHORED-FOR-US CONTENT ONLY (SCRUM-125). The user's
        // own PROMPT is deliberately NOT here: they consented to rate a
        // response, not to export their question — often about their own
        // mailbox — to a third-party processor with their identity attached.
        // `comment` stays because it is written FOR us, a different consent
        // case. The property set is pinned CLOSED by strict equality in
        // track.feedback.test.ts, so content cannot quietly rejoin the payload.
        properties: {
          rating,
          comment: comment ?? null,
          ...identityProps(email),
        },
      });
    }
  } catch (err) {
    console.warn(`[track] playground_feedback capture failed for user=${userId}`, err);
  }

  const emoji = rating === "up" ? "👍" : "👎";
  const commentText = comment && comment.length > 0 ? comment : "(no comment)";
  const promptSuffix = prompt ? ` — prompt: ${prompt.slice(0, 200)}` : "";
  void sendSlack("feedback", {
    text: `${emoji} Playground feedback from ${email ?? "unknown"}: ${commentText}${promptSuffix}`,
  });
}

/** SCRUM-149: a connect callback whose consent granted ZERO services was
 * refused — nothing written, nothing connected. Its own event rather than an
 * `account_connected` variant, so the funnel count keeps meaning a
 * connection exists; a refusal invisible to instrumentation would be a
 * one-sided measurement of exactly the drop-off this gate is about. */
export async function trackConnectRefused(
  db: Database,
  userId: string,
  provider: ProviderId,
  attribution?: Attribution | null
): Promise<void> {
  const c = getPosthog();
  if (!c) return;
  const email = await resolveUserEmail(db, userId);
  c.capture({
    distinctId: userId,
    event: EVENTS.CONNECT_REFUSED,
    properties: {
      provider,
      reason: "no_services_granted",
      ...identityProps(email),
      ...sessionProps(attribution),
    },
  });
}

export async function trackOAuthCompleted(
  db: Database,
  userId: string,
  provider: ProviderId,
  accountEmail: string,
  attribution?: Attribution | null,
  /** SCRUM-136: what the consent screen actually granted. ADDITIVE properties
   * on an era event — the event still fires on a partial grant so the funnel
   * count keeps its meaning; `grant_complete` carries the split. Optional so
   * providers without per-scope consent (Atlassian) stamp complete. */
  grant?: { complete: boolean; missing: Array<{ displayName: string }> }
): Promise<void> {
  const c = getPosthog();
  if (!c) return;
  const email = await resolveUserEmail(db, userId);
  c.capture({
    distinctId: userId,
    event: EVENTS.ACCOUNT_CONNECTED,
    properties: {
      provider,
      account_email: accountEmail,
      grant_complete: grant?.complete ?? true,
      missing_scopes: grant?.missing.map((m) => m.displayName) ?? [],
      ...identityProps(email),
      ...sessionProps(attribution),
    },
  });
}
