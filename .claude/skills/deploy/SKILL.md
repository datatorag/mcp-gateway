---
name: deploy
description: Use when deploying the DataToRAG MCP gateway to production. Handles SSH into the server, git pull, Docker rebuild, health check, and optional plugin reinstall.
user_invocable: true
---

# Deploy DataToRAG MCP Gateway

## Prerequisites

- AWS CLI configured with a profile that has Lightsail access
- The production instance runs Docker Compose on AWS Lightsail

## Pipeline path (the canary only, so far)

GitHub builds the image and the host runs it by digest; nothing is built on
the host and no checkout is needed there. Today this covers one surface, the
`canary` (a container that only answers `/health`). **The gateway is not on
this path yet**: it still deploys with the scripted path below.

```bash
# a deploy: the commit must be on main and have an image built there
gh workflow run release.yml --ref main -f surface=canary -f sha=<full-sha>
# a rollback: the commit being returned to, which must be the previous image
gh workflow run release.yml --ref main -f surface=canary -f sha=<full-sha> -f rollback=true
```

- The run stops at the `production` environment until its reviewer approves.
  The approval is a record. The go is still a person saying so, in words.
- Read the answer in the run's summary: the lines starting `host-deploy:`.
  `OK` names the sha, the digest and the previous sha. `REFUSED` changed
  nothing. `FAILED` means the host put the old image back; the line says if it
  could not.
- The digest comes from the record the build run on `main` kept
  (`scripts/published-digest.sh`), never from the registry tag. No record
  means no deploy: the commit was not built on `main`, or the record is older
  than 90 days.
- The host refuses a commit that is not on `main` or not newer than the one
  running. Going back is `rollback`, one step, to the image recorded as
  previous.
- `scripts/host-deploy.sh` is installed on the host by a person and is never
  updated by a deploy. Every answer starts with its checksum; the run warns
  when that is not the checksum of the copy on `main`. Changing the script on
  the host is a host change with its own go.
- With GitHub unavailable, an operator on the host runs
  `sudo host-deploy previous canary`, or `sudo host-deploy status` to read
  what is recorded.

## Scripted path (the gateway, until it joins the pipeline)

`scripts/deploy-gateway.sh <full-sha>` runs steps 2 to 4 below in one go, with
the host and key taken from the environment so no live value lives in the
repo:

```bash
DEPLOY_HOST=ubuntu@<ip> DEPLOY_KEY=<pem> scripts/deploy-gateway.sh <full-sha>
```

What it guarantees, and the manual path must match:

- The rollback image is tagged `docker-gateway:rollback-<sha>` from the sha
  that is RUNNING (the host's `.deployed-sha`), before anything builds. The
  checkout is verified to be the requested sha before the build.
- Only the newest five rollback tags are kept (`DEPLOY_KEEP_ROLLBACKS`); each
  is a full image and the host disk filled once with dozens of them.
- The build cache is cut back to `DEPLOY_CACHE_MAX` (default 10GB) after a
  healthy deploy, with `docker builder prune`, which never removes an image.
  It grows by gigabytes a build; left alone it reached tens of gigabytes.
- A failed build, or a container that was not recreated, stops before the
  deployed sha is recorded. The old container keeps serving and `/health`
  stays ok, so health alone never proves the new sha is live: check the
  container's created time and the served build.
- `.deployed-sha` is written only after `/health` answers ok.

It does not render `.env` (step 2b) and does not touch plugins (step 5).

## Steps

1. **Resolve SSH access**
   - Use `aws lightsail get-instances` to find the instance IP
   - Use `aws lightsail download-default-key-pair` to get the SSH key if needed
   - Save to a temp file with `chmod 600`, connect as `ubuntu@<instance-ip>`
   - If AWS CLI has SSL issues, set `AWS_CA_BUNDLE=""` as a workaround

2. **Pull latest code on the server**
   ```bash
   ssh -i <key> ubuntu@<ip> "cd ~/datatorag-mcp && git pull origin main"
   ```

2b. **Render `.env` from SSM (secrets source of truth)**
   ```bash
   ssh -i <key> ubuntu@<ip> \
     "cd ~/datatorag-mcp && AWS_PROFILE=ssm-read bash scripts/render-env.sh /datatorag-mcp/prd .env"
   ```
   - Secrets live in SSM Parameter Store under `/datatorag-mcp/prd/*` (us-west-2). Hand-editing `.env` on the server is retired — edit the parameter (`aws ssm put-parameter ... --overwrite` with the datatorag profile) and re-render.
   - The server reads via the `ssm-read` AWS profile (read-only IAM user `datatorag-mcp-server`).
   - The server runs AWS CLI v2 (installed via the official installer — the apt `awscli` package no longer exists on Ubuntu 24.04).
   - Safe to skip only when no secrets changed since the last render.

3. **Tag the rollback image, then rebuild and restart the gateway**

   The rollback tag names the sha that is RUNNING, which is the one recorded
   in `~/datatorag-mcp/.deployed-sha` on the host. It is never `git rev-parse
   HEAD` on the host: by this step the checkout has already been pulled (and a
   migration step may have pulled it earlier still), so HEAD is the incoming
   sha and a tag taken from it names the rollback after the thing you are
   about to replace it with (SCRUM-230; it happened twice in one night). The
   file is the only fallback-free source; if it does not exist yet, this is
   the first deploy under the rule, so read HEAD once, say so in the report,
   and let this deploy create the file.
   ```bash
   # rollback tag from the RUNNING sha, before anything is rebuilt
   ssh -i <key> ubuntu@<ip> 'cd ~/datatorag-mcp && OLD=$(cut -c1-7 .deployed-sha) && IMG=$(docker ps --filter name=gateway --format "{{.Image}}" | head -1) && docker tag "$IMG" "docker-gateway:rollback-$OLD" && echo "rollback-$OLD"'
   ssh -i <key> ubuntu@<ip> "cd ~/datatorag-mcp/docker && docker compose --env-file ../.env -f docker-compose.prod.yml up -d --build gateway"
   ```
   - The `.env` file lives at `~/datatorag-mcp/.env` on the server (NOT in `docker/`)
   - Must pass `--env-file ../.env` to docker compose
   - This rebuilds only the gateway container. The compose file defines no
     database service: production data is in Neon. The old host database's
     volume (`docker_postgres-data`) was left on the host as an undo and is
     not managed by compose
   - After the health check in step 4 passes, record the new sha:
     `ssh -i <key> ubuntu@<ip> "cd ~/datatorag-mcp && git rev-parse HEAD > .deployed-sha"`.
     Record it only on a passing health check; a deploy that never came up must
     not become the next deploy's rollback target.
   - Rolling back is `docker tag docker-gateway:rollback-<sha> docker-gateway:latest`
     followed by the same `compose up -d gateway` without `--build`, then the
     health check, then `.deployed-sha` set back to that sha.

4. **Health check**
   ```bash
   curl -s https://datatorag.com/health
   ```
   Wait for `{"status":"ok"}` before proceeding.

5. **Reinstall plugins if needed**
   The public POST/DELETE endpoints on `/api/servers` have been removed. To update a plugin:
   ```bash
   # SSH into server, then exec into the gateway container
   CONTAINER=$(docker ps --filter 'name=gateway' -q)

   # Pull latest code and rebuild inside the container
   docker exec $CONTAINER bash -c \
     'cd /root/.datatorag/plugins/<slug> && git pull origin main && NODE_ENV=development pnpm install && npx tsc'

   # Restart gateway so plugin process picks up new code
   cd ~/datatorag-mcp/docker && docker compose -f docker-compose.prod.yml --env-file ../.env restart gateway

   ```

   **Then change the `tools` table by exactly what the plugin change changed,
   never by re-discovery.** The registry does not resync itself on a plugin
   deploy (SCRUM-138) and is never regenerated wholesale: an existing tool
   whose description or schema changed gets one surgical `UPDATE` of its row
   (served count flat); a new tool gets one `INSERT` plus the playground
   classification commit (count moves by one, smoke suite told in advance);
   a removed tool one `DELETE`. Full recipe and the reason in the
   `ops-debugging` skill's "Plugin update + registry change" section.

   **Verify the deploy** (as of 2026-07-13, `GET /api/servers` requires auth and returns
   `{"error":"Unauthorized"}` to anonymous requests — don't use it for status checks):
   - Compare the plugin's live tool list against the `tools` table in the production DB
     (Neon, see the db-query skill; there is no database container on the host).
   - Get the live list via Streamable HTTP from inside the gateway container
     (gws-mcp listens on port 40000): POST an `initialize` request to
     `http://localhost:40000/mcp`, capture the `mcp-session-id` response header, then
     POST `tools/list` with that header and extract the tool names.
   - If the sets match and `mcp_servers.status` is `active`, no tools-table update is needed.
     If they differ by more than the rows you just changed, stop and diff them; do not
     re-discover to make them match.

6. **Clean up**
   - Remove temp SSH key files after deploy
   - Never store SSH keys or credentials permanently outside of AWS/SSH config

## Checking Logs

```bash
# Gateway container logs (last N minutes)
ssh -i <key> ubuntu@<ip> "docker logs <gateway-container> --since 30m 2>&1"

# Via compose
ssh -i <key> ubuntu@<ip> \
  "cd ~/datatorag-mcp/docker && docker compose -f docker-compose.prod.yml --env-file ../.env logs --tail 100 gateway"

# Database queries: production data lives in Neon, queried through the Neon
# MCP (see the db-query skill). Direct clients, over ssh included, are blocked
# by scripts/hooks/db-client-guard.py (SCRUM-339).
```

## Migrations

Schema changes go through the drizzle journal only:
`pnpm --filter @datatorag-mcp/db db:migrate`, from the repo root. The
production connection string lives in SSM and is never written into a
command; a connection-string URL or a `$DATABASE_URL` reference in a command
is blocked by the same hook. So a production migration is run by a human with
the environment already set, and verified through the Neon MCP by reading
`drizzle.__drizzle_migrations`.

## Plugin Repos

| Slug | Repo |
|------|------|
| gws-mcp | DataToRag/gws-mcp |

## Troubleshooting

- **A compose command warns about an unset variable**: `--env-file ../.env` was not passed.
- **Plugin build fails**: Check the `build_error` column in the `mcp_servers` table (`GET /api/servers` used to expose this as `buildError`, but the endpoint now requires auth). Common issues: missing system deps in Dockerfile, missing binaries.
- **Gateway won't start**: Check container logs for errors.
- **GWS MCP tools load but all API calls fail**: Users must separately connect their Google Workspace account via the DataToRAG web UI. The gateway stores per-user Google OAuth tokens in the `service_connections` table and forwards them to the GWS plugin via `X-User-Token` header. If no row exists for the user, or the token is expired and refresh fails, all tool calls return generic "Error occurred during tool execution" with no detail. Check the `service_connections` table for `token_expires_at` and `updated_at` to diagnose.
- **GWS binary not found (ENOENT)**: The Dockerfile needs `curl unzip` in apt-get install, and the gws-mcp `build` script must run `download-binaries.sh` before `tsc`.
