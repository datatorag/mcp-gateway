export const EVENTS = {
  /** EVERY tool call, from every surface. There is deliberately no second
   * event name: origin travels as the `surface` property, with `run_id` set
   * when the call belongs to an agent run. A parallel event would split the
   * same measurement across two streams that cannot be summed.
   *
   * CUTOVER RULE, stated once and referenced rather than repeated: rows from
   * before this change have no `surface` at all, so a query spanning it must
   * read absent as "mcp", and the agent surface's old name must be unioned in.
   * The canonical statement of that rule lives in `gateway/digest.ts`. */
  TOOL_CALL: "tool_call",
  FIRST_TOOL_CALL: "first_tool_call",
  USER_SIGNED_UP: "user_signed_up",
  USER_LOGGED_IN: "user_logged_in",
  ACCOUNT_CONNECTED: "account_connected",
  CONNECTOR_ADDED: "connector_added",
  CONNECTOR_REMOVED: "connector_removed",
  /** SCRUM-147: the default-account switch. `service` says which connector,
   * `source` which surface offered the control (same values as the
   * CONNECT_CARD_CLICKED series). The write itself is the PATCH; this is the
   * click that confirmed it. */
  DEFAULT_ACCOUNT_CHANGED: "default_account_changed",
  COPY_MCP_CONFIG: "copy_mcp_config",
  SKILL_COPIED: "skill_copied",
  MCP_REQUEST_RECEIVED: "mcp_request_received",
  MCP_SESSION_INITIALIZED: "mcp_session_initialized",
  MCP_AUTH_FAILED: "mcp_auth_failed",
  MCP_TOOLS_LISTED: "mcp_tools_listed",
  DOCS_VIEWED: "docs_viewed",
  DOCS_CTA_CLICKED: "docs_cta_clicked",
  /** A pricing-page CTA click. `cta` says which ("free" | "pro"), and for
   * "pro" the `interval` property carries the selected billing interval. A
   * click is the start of the funnel, not a subscription: the authoritative
   * "did they subscribe" signal is `users.plan`, written only by the Stripe
   * webhook. */
  PRICING_CTA_CLICKED: "pricing_cta_clicked",
  /** The dashboard's "Manage billing" click. A click means intent to reach
   * the Stripe portal, nothing more; plan changes are reported by the
   * subscription webhooks, never inferred from this. */
  BILLING_PORTAL_CLICKED: "billing_portal_clicked",
  OAUTH_REFRESH_SUCCEEDED: "oauth_refresh_succeeded",
  OAUTH_REFRESH_REPLAY: "oauth_refresh_replay",
  OAUTH_REFRESH_EXPIRED: "oauth_refresh_expired",
  OAUTH_TOKEN_REVOKED: "oauth_token_revoked",
  /** One agent turn. Emitted SERVER-SIDE, where the run id is minted, so it
   * can carry `run_id` and so it counts every run rather than only the ones
   * started from a particular button. */
  AGENT_RUN: "agent_run",
  /** First ever agent run for this user. Activation for the agent surface,
   * separate from `first_tool_call` which means a real MCP client reached the
   * gateway and which lifecycle email and the digest already key off. */
  FIRST_AGENT_RUN: "first_agent_run",
  /** A user LANDED on the Agent as their post-login destination, rather than
   * navigating to it. Separates the "landed on Agent" cohort from everyone
   * else in the funnel.
   *
   * COHORT RULE. This used to fire for new users only, because only a signup
   * was ever routed here. Every login is now, so the event on its own no
   * longer answers "how many NEW users landed on the Agent" — the
   * `landed_from` property does: `"signup"` for a post-signup landing,
   * `"login"` for a returning user's. Break the event out by that property
   * rather than reading the raw count, and read rows carrying no
   * `landed_from` at all (emitted before the property existed) as `"signup"`,
   * since that was the only case that could fire then.
   *
   * The NAME deliberately did not change: it is the join key for everything
   * already built on this event, and renaming would silently end those series
   * rather than break them. */
  AGENT_DEFAULT_VIEW_SHOWN: "agent_default_view_shown",
  PLAYGROUND_MESSAGE_SENT: "playground_message_sent",
  PLAYGROUND_CAP_HIT: "playground_cap_hit",
  /** One run's token ceiling stopped its next step (SCRUM-84). Distinct from
   * PLAYGROUND_CAP_HIT, which is the per-period RUN allowance refusing a new
   * run. */
  PLAYGROUND_RUN_CEILING_HIT: "playground_run_ceiling_hit",
  PLAYGROUND_CONFIRM: "playground_confirm",
  PLAYGROUND_FEEDBACK: "playground_feedback",
  /** The agent's in-thread connect ask reached a decision point (SCRUM-112).
   *
   * EMITTED SERVER-SIDE at the moment the `request_connection` tool places
   * (or fails to place) the card into the stream, for the same reason
   * `agent_run` moved server-side: the stored part re-renders on every
   * thread revisit, so a client-side "shown" would count reopenings and
   * inflate the denominator, while placement happens exactly once per ask.
   * `outcome` says which branch ran, one event rather than three:
   * `"shown"` (card written to the stream and the stored message),
   * `"already_connected"` (the agent asked redundantly, no card),
   * `"no_writer"` (the agent asked but the runtime could not place the card;
   * this is the silent-failure branch that has shipped before).
   * Also carries `service`, `first_agent_run` and `agent_runs_this_period`,
   * so the ask can be split by whether it was the account's first run.
   * Behaviour only: no request text, no user content. */
  CONNECT_CARD_SHOWN: "connect_card_shown",
  /** A click on a connect control (SCRUM-112). Client-side because the click
   * is a client fact. `source` says which affordance: `"thread"` for the
   * card the agent placed mid-conversation, `"empty_state"` for the standing
   * control an unconnected user sees before any message. The funnel reads:
   * connect_card_shown → connect_card_clicked is the card's copy/trust gap;
   * connect_card_clicked → account_connected is OAuth drop-off. */
  CONNECT_CARD_CLICKED: "connect_card_clicked",
  /** One hit on a `/r/<slug>` share link (SCRUM-152), counted server-side at
   * the redirect so it is independent of whether the landing page's script
   * ran. `slug`, `known` and `campaign` only — no request data. `known:false`
   * is the count of typos in comments we cannot edit; the landing itself is
   * measured by the utm tags the redirect attaches, not by this event. */
  SHARE_LINK_HIT: "share_link_hit",
  WIZARD_CLIENT_SELECTED: "wizard_client_selected",
  WIZARD_STEP_COMPLETED: "wizard_step_completed",
} as const;

export const PROVIDERS = {
  GOOGLE_WORKSPACE: "google-workspace",
  ATLASSIAN: "atlassian",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export type ProviderId = (typeof PROVIDERS)[keyof typeof PROVIDERS];
