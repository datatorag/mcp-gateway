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
  COPY_MCP_CONFIG: "copy_mcp_config",
  SKILL_COPIED: "skill_copied",
  MCP_REQUEST_RECEIVED: "mcp_request_received",
  MCP_SESSION_INITIALIZED: "mcp_session_initialized",
  MCP_AUTH_FAILED: "mcp_auth_failed",
  MCP_TOOLS_LISTED: "mcp_tools_listed",
  DOCS_VIEWED: "docs_viewed",
  DOCS_CTA_CLICKED: "docs_cta_clicked",
  OAUTH_REFRESH_SUCCEEDED: "oauth_refresh_succeeded",
  OAUTH_REFRESH_REPLAY: "oauth_refresh_replay",
  OAUTH_REFRESH_EXPIRED: "oauth_refresh_expired",
  OAUTH_TOKEN_REVOKED: "oauth_token_revoked",
  /** One agent turn. Emitted SERVER-SIDE, where the run id is minted, so it
   * can carry `run_id` and so it counts every run rather than only the ones
   * started from a particular button. */
  AGENT_RUN: "agent_run",
  /** A new user LANDED on the Agent as their post-login destination, rather
   * than navigating to it. Separates the "landed on Agent" cohort from
   * pre-launch signups in the funnel. */
  AGENT_DEFAULT_VIEW_SHOWN: "agent_default_view_shown",
  PLAYGROUND_MESSAGE_SENT: "playground_message_sent",
  PLAYGROUND_CAP_HIT: "playground_cap_hit",
  PLAYGROUND_CONFIRM: "playground_confirm",
  PLAYGROUND_FEEDBACK: "playground_feedback",
  WIZARD_CLIENT_SELECTED: "wizard_client_selected",
  WIZARD_STEP_COMPLETED: "wizard_step_completed",
} as const;

export const PROVIDERS = {
  GOOGLE_WORKSPACE: "google-workspace",
  ATLASSIAN: "atlassian",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export type ProviderId = (typeof PROVIDERS)[keyof typeof PROVIDERS];
