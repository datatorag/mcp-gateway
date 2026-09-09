---
name: deploy
description: Use when deploying the DataToRAG MCP gateway to production. Handles SSH into the server, git pull, Docker rebuild, health check, and optional plugin reinstall.
user_invocable: true
---

# Deploy DataToRAG MCP Gateway

## Prerequisites

- AWS CLI configured with a profile that has Lightsail access
- The production instance runs Docker Compose on AWS Lightsail

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
   - This rebuilds only the gateway container; postgres data is preserved in a volume
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
     (Neon — see the db-query skill; do NOT psql the docker postgres, that's dev-only).
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

# Database queries — NOTE: production data lives in Neon (use the db-query skill),
# NOT in the docker postgres on this host. Only psql the container for local/dev-era data.
ssh -i <key> ubuntu@<ip> "docker exec <postgres-container> env | grep POSTGRES"
ssh -i <key> ubuntu@<ip> \
  "docker exec <postgres-container> psql -U <db-user> -d <db-name> -c '<query>'"
```

## Plugin Repos

| Slug | Repo |
|------|------|
| gws-mcp | DataToRag/gws-mcp |

## Troubleshooting

- **db-init fails**: Usually missing `POSTGRES_PASSWORD`. Ensure `--env-file ../.env` is passed.
- **Plugin build fails**: Check the `build_error` column in the `mcp_servers` table (`GET /api/servers` used to expose this as `buildError`, but the endpoint now requires auth). Common issues: missing system deps in Dockerfile, missing binaries.
- **Gateway won't start**: Check container logs for errors.
- **GWS MCP tools load but all API calls fail**: Users must separately connect their Google Workspace account via the DataToRAG web UI. The gateway stores per-user Google OAuth tokens in the `service_connections` table and forwards them to the GWS plugin via `X-User-Token` header. If no row exists for the user, or the token is expired and refresh fails, all tool calls return generic "Error occurred during tool execution" with no detail. Check the `service_connections` table for `token_expires_at` and `updated_at` to diagnose.
- **GWS binary not found (ENOENT)**: The Dockerfile needs `curl unzip` in apt-get install, and the gws-mcp `build` script must run `download-binaries.sh` before `tsc`.
