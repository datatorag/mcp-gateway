#!/usr/bin/env bash
# Render an .env file from AWS SSM Parameter Store.
# Usage: render-env.sh [ssm-path] [outfile]
#   AWS_PROFILE / AWS_REGION respected; defaults: path /datatorag-mcp/prd, outfile ./.env
set -euo pipefail

SSM_PATH="${1:-/datatorag-mcp/prd}"
OUT="${2:-.env}"
REGION="${AWS_REGION:-us-west-2}"

aws ssm get-parameters-by-path \
  --path "$SSM_PATH" --with-decryption --region "$REGION" --output json \
  | jq -r '.Parameters[] | (.Name | split("/") | last) + "=" + .Value' \
  | sort > "$OUT.tmp"

COUNT=$(wc -l < "$OUT.tmp" | tr -d ' ')
if [ "$COUNT" -eq 0 ]; then
  echo "ERROR: no parameters found under $SSM_PATH — refusing to write empty $OUT" >&2
  rm -f "$OUT.tmp"
  exit 1
fi

mv "$OUT.tmp" "$OUT"
chmod 600 "$OUT"
echo "rendered $COUNT vars from $SSM_PATH -> $OUT"
