#!/usr/bin/env bash
# Render an .env file from AWS SSM Parameter Store.
# Usage: render-env.sh [ssm-path] [outfile]
#   AWS_PROFILE / AWS_REGION respected; defaults: path /datatorag-mcp/prd, outfile ./.env
#
# On a laptop it is run from a checkout, for the dev file (see .env.example).
#
# On the production host it does not need a checkout: a person installs a
# copy beside the deploy files and renders the gateway's env file where both
# deploy paths read it (see the deploy skill):
#   AWS_PROFILE=<read-only profile> /opt/datatorag-deploy/bin/render-env \
#     /datatorag-mcp/prd /opt/datatorag-deploy/env/gateway.env
#
# The new file replaces the old one in one step and only if something was
# read: a failed or empty read leaves the file that was there. A running
# gateway keeps the values it started with until it is restarted.
set -euo pipefail
# The file holds secrets from its first byte: nobody else may read it while it
# is being written, whatever the folder's mode is.
umask 077

SSM_PATH="${1:-/datatorag-mcp/prd}"
OUT="${2:-.env}"
REGION="${AWS_REGION:-us-west-2}"

trap 'rm -f "$OUT.tmp"' EXIT
aws ssm get-parameters-by-path \
  --path "$SSM_PATH" --with-decryption --region "$REGION" --output json \
  | jq -r '.Parameters[] | (.Name | split("/") | last) + "=" + .Value' \
  | sort > "$OUT.tmp"

COUNT=$(wc -l < "$OUT.tmp" | tr -d ' ')
if [ "$COUNT" -eq 0 ]; then
  echo "ERROR: no parameters found under $SSM_PATH. Refusing to write an empty $OUT" >&2
  rm -f "$OUT.tmp"
  exit 1
fi

mv "$OUT.tmp" "$OUT"
chmod 600 "$OUT"
echo "rendered $COUNT vars from $SSM_PATH -> $OUT"
