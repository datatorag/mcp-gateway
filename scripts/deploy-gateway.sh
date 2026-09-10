#!/bin/bash
# Deploy one exact commit of main to the gateway host, with a rollback image
# tagged from what is RUNNING before the build, and only the newest few
# rollback tags kept.
#
# Usage:
#   DEPLOY_HOST=ubuntu@<host> DEPLOY_KEY=<path-to-pem> scripts/deploy-gateway.sh <full-sha>
#
# Optional: DEPLOY_HEALTH_URL (default https://datatorag.com/health),
#           DEPLOY_KEEP_ROLLBACKS (default 5).
#
# Rules this encodes (see .claude/skills/deploy/SKILL.md):
# - The rollback tag names the sha that is RUNNING (the host's .deployed-sha),
#   never the checkout, which a migration step may already have moved.
# - The checkout is verified to be the requested sha before anything builds.
# - A failed build, or a container that was not recreated, stops the script
#   before the deployed sha is recorded: the old container keeps serving and
#   health stays ok, so health alone proves nothing about the new sha.
# - Every rollback image is a full gateway image. Only the newest
#   DEPLOY_KEEP_ROLLBACKS tags survive a deploy; the host disk filled once with
#   dozens of them.
set -euo pipefail

WANT="${1:-}"
[ -n "$WANT" ] || { echo "usage: $0 <full-sha>"; exit 2; }
[ -n "${DEPLOY_HOST:-}" ] || { echo "DEPLOY_HOST is not set"; exit 2; }
[ -n "${DEPLOY_KEY:-}" ] || { echo "DEPLOY_KEY is not set"; exit 2; }
HEALTH_URL="${DEPLOY_HEALTH_URL:-https://datatorag.com/health}"
KEEP="${DEPLOY_KEEP_ROLLBACKS:-5}"
SSH="ssh -i $DEPLOY_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 $DEPLOY_HOST"

echo "##### want sha: $WANT"
echo "##### before: server HEAD, gateway container"
$SSH 'cd ~/datatorag-mcp && git rev-parse HEAD && docker ps --filter name=gateway --format "{{.Names}} {{.Image}} {{.Status}}"'

OLD=$($SSH 'cd ~/datatorag-mcp && (cut -c1-7 .deployed-sha 2>/dev/null) || true')
[ -n "$OLD" ] || OLD=$($SSH 'cd ~/datatorag-mcp && git rev-parse --short HEAD')
echo "##### rollback tag: rollback-$OLD (from the running sha)"
$SSH "IMG=\$(docker ps --filter name=gateway --format '{{.Image}}' | head -1); docker tag \"\$IMG\" \"docker-gateway:rollback-$OLD\""

echo "##### keep the newest $KEEP rollback tags"
# Never the tag this run just made: after a rollback deploy the running image is
# older-built than newer rollback images, and pruning by build time would take
# away the one rollback point this deploy needs.
$SSH "docker images docker-gateway --format '{{.CreatedAt}}|{{.Tag}}' | grep '|rollback-' | grep -v '|rollback-$OLD\$' | sort -r | tail -n +$((KEEP)) | cut -d'|' -f2 | while read -r t; do [ -n \"\$t\" ] && docker rmi -f \"docker-gateway:\$t\" >/dev/null && echo \"  removed rollback tag \$t\"; done; true"
$SSH "docker images docker-gateway --format '  {{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedSince}}' | grep rollback"

echo "##### fetch + checkout the merge sha"
$SSH "cd ~/datatorag-mcp && git fetch -q origin && git checkout -q main && git pull -q --ff-only origin main && git rev-parse HEAD"
GOT=$($SSH 'cd ~/datatorag-mcp && git rev-parse HEAD')
[ "$GOT" = "$WANT" ] || { echo "SERVER SHA MISMATCH: got $GOT want $WANT; stopping before build"; exit 1; }
echo "server sha verified: $GOT"

echo "##### disk"
$SSH 'df -h / | tail -1'

echo "##### build + restart gateway"
BEFORE_CREATED=$($SSH 'docker ps --filter name=gateway --format "{{.CreatedAt}}" | head -1')
$SSH 'cd ~/datatorag-mcp/docker && docker compose --env-file ../.env -f docker-compose.prod.yml up -d --build gateway > /tmp/deploy-build.log 2>&1; rc=$?; tail -15 /tmp/deploy-build.log; exit $rc' \
  || { echo "BUILD/UP FAILED; the old container keeps serving; deployed sha NOT recorded. Full log on the host: /tmp/deploy-build.log"; exit 1; }
AFTER_CREATED=$($SSH 'docker ps --filter name=gateway --format "{{.CreatedAt}}" | head -1')
$SSH 'docker ps --filter name=gateway --format "{{.Names}} {{.Image}} {{.Status}} created={{.CreatedAt}}"'
[ "$AFTER_CREATED" != "$BEFORE_CREATED" ] || { echo "container was NOT recreated; deployed sha NOT recorded"; exit 1; }

echo "##### health"
h=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  h=$(curl -s --max-time 10 "$HEALTH_URL?cb=$(date +%s)" || true)
  echo "  $h"
  case "$h" in *'"status":"ok"'*) break;; esac
  sleep 6
done
case "$h" in
  *'"status":"ok"'*) $SSH "cd ~/datatorag-mcp && echo $WANT > .deployed-sha" && echo "recorded deployed sha on the host";;
  *) echo "health never ok; deployed sha NOT recorded"; exit 1;;
esac
