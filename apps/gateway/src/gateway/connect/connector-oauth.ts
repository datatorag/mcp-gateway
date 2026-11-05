/**
 * What a connector supplies to the shared connect flow (`mount-connect-flow.ts`):
 * the three steps that differ between providers (the authorize URL, the code
 * exchange and the identity lookup) and the few settings that do. Everything
 * else in a connect round trip is the flow's.
 */
import type { DuplicateProvider } from "../connect-duplicate";

/** The app credentials and base URL a connector reads; the auth router's
 * config, narrowed to what connectors use. */
export interface ConnectConfig {
  baseUrl: string;
  brevoClientId?: string;
  brevoClientSecret?: string;
  slackClientId?: string;
  slackClientSecret?: string;
  /** The one Slack workspace allowed to connect. */
  slackTeamId?: string;
}

export interface ConnectContext {
  config: ConnectConfig;
  /** This connector's callback URL, the one registered with the provider. */
  redirectUri: string;
}

/** What a code exchange gave back. `accessToken` is always a string: the
 * flow refuses an answer without one before a connector sees it. */
export interface ConnectTokens {
  accessToken: string;
  refreshToken?: string;
  /** Seconds. The flow stores an expiry only for a positive number. */
  expiresIn?: unknown;
  /** The grant's scopes as the provider reported them, when it does. */
  scope?: string;
  /** The parsed answer, for an `identify` that needs more of it. */
  raw: Record<string, unknown>;
}

/** Who the grant belongs to. `email` is required: an account is keyed by it. */
export interface ConnectIdentity {
  email: string;
  /** Whether the provider says it verified the address. A connect only a
   * link vouches for completes only on a verified one. */
  emailVerified: boolean;
  /** The provider's id for the account (a workspace, a project), when one
   * email can hold several. */
  externalAccountId: string | null;
  label: string | null;
}

export interface ConnectorOAuth {
  provider: DuplicateProvider;
  /** The start route; the callback is this plus `/callback`. */
  path: string;
  /** The one-shot cookie holding this round trip's nonce. */
  nonceCookie: string;
  /** The scopes stored with the account, or null to store none beyond
   * what the grant reports (see `storesGrantedScope`). */
  scopes: string | null;
  /** Store the scope the provider reports for this grant (the exchange's
   * `scope`), not only `scopes`. */
  storesGrantedScope?: boolean;
  /** Hidden until its registry row is launched, and re-checked at the
   * callback. */
  gated: boolean;
  /** How a service not offered to this user is refused: a connect error, or
   * a plain 404 for one only admins may see. */
  notOffered: "redirect" | "404";
  isConfigured(config: ConnectConfig): boolean;
  authorizeUrl(ctx: ConnectContext, nonce: string): URL;
  /** The provider's answer to the code, parsed, or null when it refused.
   * May throw; the flow treats a throw as a refused exchange. */
  exchange(code: string, ctx: ConnectContext): Promise<Record<string, unknown> | null>;
  /** The account behind the tokens; null when its email cannot be read, or a
   * connect error of the provider's own (a grant with no workspace). */
  identify(tokens: ConnectTokens, ctx: ConnectContext): Promise<ConnectIdentity | { error: string } | null>;
}
