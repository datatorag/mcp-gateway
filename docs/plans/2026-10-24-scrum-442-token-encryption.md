# Provider Tokens Encrypted at Rest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every provider OAuth token encrypted with AES-256-GCM under a key the database never sees, without production ever being unreadable on the way and without any user noticing.

**Architecture:**
- `token-crypto.ts` encrypts values directly with AES-256-GCM and a key id, in a `v1.<key id>.<nonce>.<ciphertext>` format, with AAD binding each value to its table, column, user and row. A KMS-wrapped per-row data key is the upgrade if the key ever leaks.
- `service_connections` gets `*_sealed` columns beside the plaintext ones: writes go to both, a command backfills, reads switch to sealed, then the plaintext columns are dropped. The legacy `plugin_connections` is sealed-only from release 1.
- Opening happens only in `service-token.ts` and the commands module.

**Tech Stack:** TypeScript, Node `crypto` (AES-256-GCM), Drizzle ORM and drizzle-kit migrations, tsup, vitest. No new dependency.

**Spec:** `docs/architecture/2026-10-24-scrum-442-token-encryption-design.md`

## Global Constraints

- **Invisible to users.** No step, and no rollback, logs anyone out or asks anyone to reconnect. No step rotates stored refresh tokens.
- **Cipher.** AES-256-GCM. A 12-byte nonce from `randomBytes` for every seal. A 16-byte tag.
- **Format.** `v1.<key id>.<base64url nonce>.<base64url ciphertext and tag>`. AAD is `<table>.<column>:<user_id>:<row_id>`; inserts generate the row id in the application.
- **Key.** `CONNECTION_TOKEN_KEYS` is a comma-separated list of `<id>:<base64 of exactly 32 bytes>`, where `id` matches `[a-z0-9]{1,16}`. The first entry seals, and all entries open.
- **Never print a token.** No log line, error message, commit message or changelog carries a token, a key or a sealed value. Errors name the table and column only.
- **Who opens.** Only `apps/gateway/src/gateway/service-token.ts` and `apps/gateway/src/gateway/token-crypto-commands.ts` import `openToken` (tests excepted).
- **Production schema steps:** Manuel confirms the SQL, naming the target; this session runs `pnpm --filter @datatorag-mcp/db db:migrate` from the repo root.
- **Production commands** (`backfill`, `reencrypt`, `restore`) are run by HQ in the gateway container on the production host, on Manuel's confirm naming the target: `docker compose --env-file <gateway env file> -f <gateway compose file> exec gateway node dist/tokens.js <command>`, with the files the deploy skill names. This session never runs them.
- **Deploys** are HQ's. Each release is its own deploy, in order.
- **Public repo:** the rule, never the evidence. No review text, finding ids, row counts or infrastructure paths in code, docs or commits.
- **Tests run as:**
  - `cd apps/gateway && env -u NODE_TLS_REJECT_UNAUTHORIZED node --env-file=<repo-root>/.env node_modules/vitest/vitest.mjs run <files>`;
  - the gate: `env -u NODE_TLS_REJECT_UNAUTHORIZED sh scripts/gate.sh`.

## Review Focus

1. **A connect that races the backfill.** A user reconnects while the backfill is sealing their row. The backfill's update is guarded by the read plaintext and an empty sealed column, so it must not overwrite the new token with a seal of the old one. Test: Task 3.
2. **The Notion refresh after release 2.** Two seals of one refresh token never compare equal, so a comparison of sealed values would treat every refresh as "someone else rotated" and return a stale token forever. Test: Task 4.
3. **A key list with the old key removed too early.** A value sealed under a missing id must fail closed with a sentence naming the table, never fall back to plaintext and never crash the dispatch. Test: Task 1 and Task 4.
4. **A row with no sealed value at release 2.** The backfill's exit code makes this a zero-row case; if one existed anyway, the read refuses and says so, and never serves plaintext. Test: Task 3 (the exit code) and Task 4 (the refusal).
5. **A rollback during release 3.** Rows written by release 3's image have null or stale plaintext. Restore must make every row read current values for release 1's image. Test: Task 3.

---

## Step 0: the key

- [ ] Manuel creates the production parameter himself, with the value generated inline, so no session holds it and no command text contains it:
  `aws ssm put-parameter --profile <profile> --type SecureString --name <production parameter path>/CONNECTION_TOKEN_KEYS --value "k1:$(openssl rand -base64 32)"`
  The `k1:` is the key id the list format needs. The development key is made the same way into the developer's own `.env`.
- [ ] The parameter exists before release 1 deploys, or the gateway refuses to start.

## Release 1: the key, the module, writing both, and the backfill

### Task 1: The key and the crypto module

**Files:**
- Create: `apps/gateway/src/gateway/token-crypto.ts`, `apps/gateway/src/gateway/token-crypto.test.ts`.
- Modify: `packages/config/src/index.ts`. Add `CONNECTION_TOKEN_KEYS` with a validator that parses the list, and refuses an empty list, a key that is not 32 bytes, a repeated id, or a malformed entry.
- Modify: `packages/config` tests, the vitest setup in `apps/gateway` (a fixed test key), `.env.example`, `docker/docker-compose.dev.yml` and `docker/docker-compose.prod.yml` (the variable in the environment list).

**Interfaces:**
- Produces:
  - `type SealContext = { table: "service_connections" | "plugin_connections"; column: "access_token" | "refresh_token"; userId: string; rowId: string }`;
  - `sealToken(value: string, ctx: SealContext): string`;
  - `openToken(sealed: string, ctx: SealContext): string`, which throws `TokenOpenError`, whose message is `"<table>.<column> could not be opened"`;
  - `sealedKeyId(sealed: string): string | null`, null for a value not in the format.
- Keys come from `getEnv().CONNECTION_TOKEN_KEYS`, parsed once.

- [ ] **Step 1: Write the failing tests.**
  - **Round trip.** A value round-trips. Two seals of one value differ.
  - **Tampering.** Flipping one byte of the ciphertext, the tag or the nonce fails to open. Changing the key id fails too.
  - **Binding.** A value sealed for user A's row R opens there, but not for user B, not for A's other row, and not for another column or table.
  - **Keys.**
    - A value sealed by key `a` opens when the list is `b,a`.
    - A new seal with list `b,a` carries id `b`, and `sealedKeyId` returns `b`.
    - An id not in the list fails.
    - `sealedKeyId` returns null for a plain token.
  - **Errors.** No error message contains the value or the sealed string.
  - **Config.** The validator refuses each malformed list with a sentence naming `CONNECTION_TOKEN_KEYS` and no value.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `createCipheriv("aes-256-gcm", key, nonce)` with `setAAD`, and `getAuthTag()` appended to the ciphertext.
- [ ] **Step 4: Run them and the config tests. Rebuild `packages/config`** (the gateway consumes its `dist/`). Expected: PASS.
- [ ] **Step 5: Commit.** `feat(gateway): seal and open provider tokens`

### Task 2: Expand: sealed columns, both writes, and the legacy table sealed-only

**Files:**
- Modify: `packages/db/src/schema/service-connections.ts` and `plugin-connections.ts`. Add `accessTokenSealed: text("access_token_sealed")` and `refreshTokenSealed: text("refresh_token_sealed")`, nullable. In `plugin-connections.ts`, `accessToken` drops `.notNull()`.
- Create: migration 1 via `pnpm --filter @datatorag-mcp/db db:generate`. Review that it only adds the four columns and drops the one constraint, then put first, by hand, a `DO` block that raises if `plugin_connections` has any row.
- Modify every write site:
  - `apps/gateway/src/gateway/connected-accounts.ts` `upsertServiceAccount` (update and insert): sealed beside plaintext. The update seals with the existing row's id; only the insert generates one, with `randomUUID()`, passed as `id`.
  - `apps/gateway/src/gateway/service-token.ts`, the three refresh writes: sealed beside plaintext.
  - `apps/gateway/src/app/api/servers/[slug]/connect/callback/route.ts` (update and insert): sealed only, plaintext null; the insert generates its id the same way.
- Modify: `apps/gateway/src/gateway/service-token.ts`. New `resolvePluginConnectionToken(db, userId, mcpServerId): Promise<string | null>`, reading and opening the sealed access token.
- Modify: `apps/gateway/src/gateway/mcp-server.ts:~1307`. The legacy read calls `resolvePluginConnectionToken`.
- Delete: `packages/db/src/backfill-connected-accounts.ts` and its entries in `scripts/pattern-check.mjs`.
- Test: each write site's existing test file, and `mcp-server*.test.ts`.

**Interfaces:**
- Consumes: `sealToken`, `openToken` (Task 1).
- Every write passes its user id and row id. The refresh functions use the row's `user_id` and `id`, read alongside the row (a refresh function gains `userId` and `rowId` parameters from `resolveServiceToken`).

- [ ] **Step 1: Write the failing tests.**
  - For each `service_connections` write site: the values written include `accessTokenSealed` and `refreshTokenSealed`; those open, with the right context, to the plaintext also written; a null refresh token writes a null sealed refresh token.
  - `upsertServiceAccount` updating an existing row: the sealed value opens with that row's id.
  - The plugin callback writes sealed values and null plaintext, and they open.
  - The dispatch's legacy path passes the opened plugin token.
  - Migration 1 refuses on a database where `plugin_connections` has a row.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the gateway suite; typecheck.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat: provider tokens are written sealed`

### Task 3: Backfill, re-encrypt and restore commands, in the image

**Files:**
- Create: `apps/gateway/src/gateway/token-crypto-commands.ts`, `apps/gateway/src/gateway/token-crypto-commands.test.ts` (DB-backed, against the test database).
- Modify: `apps/gateway/tsup.config.ts`. A second entry, `entry: { server: "server.ts", tokens: "src/gateway/token-crypto-commands.ts" }`, so the build writes `dist/tokens.js` beside `dist/server.js`. The image already copies `dist/`.

**Interfaces:**
- `backfillSealed(db): Promise<{ sealed: number; skipped: number; unsealed: number }>`, on `service_connections`.
- `reencryptSealed(db): Promise<{ resealed: number; skipped: number }>`, on both tables.
- `restorePlaintext(db): Promise<{ restored: number; failed: number }>`, on `service_connections`.
- `backfill` and `reencrypt` are one loop with a predicate. **One guarded `UPDATE` per row:**
  - backfill, for each column on its own: `WHERE id = $id AND <column> IS NOT DISTINCT FROM $old AND <column>_sealed IS NULL`. The predicate is per column too: a Google refresh in release 1 seals only the access token, so a row can have its access column sealed and its refresh column not;
  - reencrypt and restore: `WHERE id = $id AND access_token_sealed IS NOT DISTINCT FROM $oldSealed` (and the same for the refresh column).
- **Exit code.** `backfill` exits non-zero when, after its pass, `count(*)` of rows with `access_token IS NOT NULL AND access_token_sealed IS NULL` (or the same for the refresh columns) is above 0. `restore` exits non-zero when any value failed to open.
- **Output.** Only the counts are printed.

- [ ] **Step 1: Write the failing tests.**
  - **Backfill.**
    - Seals every column whose sealed column is null, checked for both columns, and a second run reports 0 and exits 0.
    - A row whose access token changes between the read and the update, or that a concurrent write already sealed, is skipped and left alone; the next run finds it sealed (Review Focus 1).
    - With an unsealable row left (simulated), it exits non-zero (Review Focus 4).
    - A row whose access token a Google refresh sealed before the backfill, with its refresh token still unsealed: the backfill seals the refresh column and exits 0.
  - **Re-encrypt.** With list `b,a`, re-seals every value carrying id `a` under `b` in both tables, and leaves `b` values alone.
  - **Restore.** Rewrites plaintext from the sealed value in rows where it is null or stale (Review Focus 5). Fails, naming the table, on a value that will not open, continues with the rest, and exits non-zero.
  - **Output.** No command's output contains a token.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them; `pnpm build` writes `dist/tokens.js`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(gateway): commands to backfill, re-encrypt and restore sealed tokens`

### Release 1, at release

- [ ] Task 4's end-to-end proof (below) has passed.
- [ ] Manuel confirms migration 1, naming the target; this session runs `db:migrate` on production.
- [ ] HQ deploys release 1.
- [ ] HQ runs `backfill` in the container, on Manuel's confirm naming the target. It exits 0.

## Release 2: reads use the sealed columns

### Task 4: Open only where a token is handed on

**Files:**
- Modify: `apps/gateway/src/gateway/service-token.ts`.
  - `resolveServiceToken` selects the sealed columns and opens them.
  - Each refresh function opens what it compares and what it returns. The Notion refresh compares opened values in both of its locked reads.
  - `revokeUpstream(service, sealed, { userId, rowId })` takes sealed values and the row's context, and opens them.
- Modify: `apps/gateway/src/gateway/connected-accounts.ts`. Both disconnect paths select the sealed columns and pass them on unopened.
- Create: `apps/gateway/src/gateway/token-open-rule.test.ts`.
- Test: `service-token*.test.ts`, `connected-accounts*.test.ts`.

**Interfaces:**
- Consumes: `openToken`, `TokenOpenError` (Task 1).
- **A row with a null sealed access token** is refused: `resolveServiceToken` returns null and logs `[service-token] <service> connection has no sealed token` (no ids, no values). It never falls back to plaintext. The backfill gate makes this a zero-row case in production.
- **A value that will not open** is refused the same way, with the `TokenOpenError` message.

- [ ] **Step 1: Write the failing tests.**
  - **Resolver.** `resolveServiceToken` returns the opened token for all three selects. A row with only plaintext returns null (Review Focus 4). A value sealed under an unlisted key returns null without throwing (Review Focus 3).
  - **Refresh.**
    - Each refresh function sends the provider the opened refresh token.
    - The Notion refresh, given a presented token equal to the stored one but sealed again, calls Notion. It does not return the stored access token as "rotated" (Review Focus 2).
  - **Revoke.** `revokeUpstream` sends the provider opened tokens. Both disconnect paths pass sealed values to it.
  - **The open rule.** `token-open-rule.test.ts` scans `apps/gateway/src` and `apps/gateway/server.ts`, and fails if any file but `service-token.ts` and `token-crypto-commands.ts` (tests excepted) imports `openToken`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the gateway suite.** Expected: PASS.
- [ ] **Step 4.5: End-to-end proof, before release 1's go.** It needs this task's sealed reads, so it runs once this task is built on its branch, and release 1 waits for it. HQ provides a development Neon branch that is not a copy of production; a development key.
  - Apply migration 1, insert synthetic connection rows, run `node dist/tokens.js backfill`; it exits 0.
  - Null the plaintext of one `service_connections` row; start this task's image against the branch and resolve that row.
  - Run `restore`; `sha256` of the restored value equals the original's.
  - Record only counts and the match.
- [ ] **Step 5: Commit.** `feat(gateway): provider tokens are read sealed and opened only where they are handed on`

### Release 2, at release

- [ ] HQ reruns `backfill`; it exits 0.
- [ ] HQ deploys release 2.
- [ ] The runner's full scope passes on production: every connector resolves a token through the new path.

## Release 3: contract

### Task 5: Sealed only, then drop the plaintext columns

**Files:**
- Modify: both schema files. Remove `accessToken` and `refreshToken`.
- Create: migration A, which only drops `NOT NULL` on `service_connections.access_token`. Migration B, which opens with a `DO` block that raises if `count(*)` of rows with `access_token IS NOT NULL AND access_token_sealed IS NULL` (or the same for the refresh columns) is above 0, then drops the four plaintext columns. Generate A first, from the schema with only `accessToken`'s `.notNull()` dropped; then B, from the schema with the columns removed, adding the block by hand.
- Modify: any remaining reference. The typecheck finds them. The write sites write sealed only.
- Modify: `.claude/skills/codebase-map/SKILL.md`. One line: provider tokens are sealed by `token-crypto.ts` under `CONNECTION_TOKEN_KEYS`, opened only in `service-token.ts` and `token-crypto-commands.ts`, rotated by `node dist/tokens.js reencrypt`.

- [ ] **Step 1: Change the write-site tests to "sealed only".** Expected: FAIL.
- [ ] **Step 2: Remove the columns from the schema and typecheck.** Fix every reference.
- [ ] **Step 3: Run the gateway suite.** Expected: PASS.
- [ ] **Step 4: Commit.** `feat: drop the plain provider token columns`
- [ ] **Step 5, at release:**
  - Manuel confirms migration A; this session runs it.
  - HQ deploys release 3's image. It does not reference the plaintext columns, so it runs on the schema with and without them.
  - A soak. Rollback in it: release 2's image plus `restore`.
  - Manuel confirms migration B; this session runs it. Rollback after it: re-add the columns, `restore`, release 2's image.
- [ ] **Step 6, after the drop: copies made earlier.** HQ deletes the database branches copied from production before the drop, and waits out the restore window. No reconnect is forced and no stored token is rotated. The spec's "What this achieves, and what it does not" states what remains usable until then.
