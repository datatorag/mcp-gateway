export const EVENTS = {
  TOOL_CALL: "tool_call",
  USER_SIGNED_UP: "user_signed_up",
  USER_LOGGED_IN: "user_logged_in",
  ACCOUNT_CONNECTED: "account_connected",
  CONNECTOR_ADDED: "connector_added",
  CONNECTOR_REMOVED: "connector_removed",
  COPY_MCP_CONFIG: "copy_mcp_config",
  DOCS_VIEWED: "docs_viewed",
  OAUTH_REFRESH_SUCCEEDED: "oauth_refresh_succeeded",
  OAUTH_REFRESH_REPLAY: "oauth_refresh_replay",
  OAUTH_REFRESH_EXPIRED: "oauth_refresh_expired",
  OAUTH_TOKEN_REVOKED: "oauth_token_revoked",
} as const;

export const PROVIDERS = {
  GOOGLE_WORKSPACE: "google-workspace",
  ATLASSIAN: "atlassian",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export type ProviderId = (typeof PROVIDERS)[keyof typeof PROVIDERS];
