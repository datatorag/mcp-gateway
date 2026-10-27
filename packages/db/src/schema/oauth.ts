import { pgTable, text, timestamp, uuid, jsonb, index, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

// Dynamic client registration (RFC 7591)
export const oauthClients = pgTable("oauth_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id").notNull().unique(),
  clientSecret: text("client_secret"),
  redirectUris: jsonb("redirect_uris").notNull().$type<string[]>(),
  clientName: text("client_name"),
  grantTypes: jsonb("grant_types").notNull().$type<string[]>(),
  responseTypes: jsonb("response_types").notNull().$type<string[]>(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method")
    .notNull()
    .default("none"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Authorization codes (short-lived, exchanged for tokens)
export const oauthAuthorizationCodes = pgTable("oauth_authorization_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  // sha256(code) as hex, as `token_hash` above (SCRUM-443).
  codeHash: text("code_hash").unique(),
  clientId: text("client_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
  scope: text("scope"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Access tokens
export const oauthAccessTokens = pgTable("oauth_access_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(),
  // sha256(token) as hex (SCRUM-443). Written beside the raw value from
  // release 1, read from release 2; the raw column goes in release 3.
  tokenHash: text("token_hash").unique(),
  clientId: text("client_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scope: text("scope"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Refresh tokens (RFC 6749 + OAuth 2.1)
// Stored as sha256(rawToken). One-time-use with rotation; presenting a revoked
// token revokes the entire familyId.
export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedByTokenId: uuid("replaced_by_token_id"),
    familyId: uuid("family_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_oauth_refresh_tokens_user").on(table.userId),
    index("idx_oauth_refresh_tokens_family").on(table.familyId),
    // Partial index for replay-revoke and family-revoke hot paths.
    index("idx_oauth_refresh_tokens_family_live")
      .on(table.familyId)
      .where(sql`revoked_at IS NULL`),
  ]
);

// Consent a user gave an MCP client (SCRUM-373), remembered per (user, client).
// The first sign-in from a new registration shows the consent page; once
// approved, that client is issued codes without it.
export const oauthConsents = pgTable(
  "oauth_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("oauth_consents_user_client_unique").on(table.userId, table.clientId)]
);

/** The validated authorization flow a consent page answers for. */
export type PendingConsentFlow = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string | null;
  scope: string | null;
};

// A consent page waiting for an answer (SCRUM-373). Bound to the browser by a
// one-time nonce whose sha256 is stored here and whose raw value is in an
// httpOnly cookie; one use, ten minutes.
export const oauthPendingConsents = pgTable("oauth_pending_consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  nonceHash: text("nonce_hash").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  flow: jsonb("flow").notNull().$type<PendingConsentFlow>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
