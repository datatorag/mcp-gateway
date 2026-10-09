#!/usr/bin/env bash
set -euo pipefail

# Load .env if it exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Validate OAuth credentials are set
if [ -z "${GWS_OAUTH_CLIENT_ID:-}" ] || [ -z "${GWS_OAUTH_CLIENT_SECRET:-}" ]; then
  echo "Error: Set GWS_OAUTH_CLIENT_ID and GWS_OAUTH_CLIENT_SECRET in .env or environment" >&2
  exit 1
fi

# Build TypeScript
npx tsc

# Write OAuth credentials into bundle
cat > server/oauth.json <<EOF
{"clientId":"$GWS_OAUTH_CLIENT_ID","clientSecret":"$GWS_OAUTH_CLIENT_SECRET"}
EOF

# Pack extension with prod dependencies only
rm -rf node_modules
npm install --omit=dev
mcpb pack . google-workspace-mcp.mcpb

# Clean up
rm -f server/oauth.json
rm -rf node_modules
pnpm install
