#!/usr/bin/env bash
# Start each plugin FROM A BUILT GATEWAY IMAGE, ask it for the tools it serves,
# and write one tool file per plugin (SCRUM-390).
#
#   scripts/image-plugin-tools.sh <image ref> <out dir>
#
# Writes <out dir>/tools-<slug>.json for every directory under plugins/ in this
# checkout. The build workflow runs it after building the gateway image, on a
# pull request as well as on main, so an image whose plugin does not start, or
# serves nothing, is seen before the merge. On main the files are kept beside
# the image's digest record; `pnpm registry:diff` reads them from there.
#
# Each plugin is started the way the gateway's manager starts it: from its own
# directory in the image, with PATH, NODE_ENV and PORT and nothing else, as its
# own non-root account (plugin-<slug>). So a plugin that needs something more
# from its environment, or needs to be root, or has no account in the image,
# fails here. It is also checked that the account cannot write the plugin's
# files and that no two plugins share one.
#
# It also refuses an image that holds an oauth.json under /app/plugins: that
# file carries a client secret and only a desktop bundle's build writes it.
set -euo pipefail

[ $# -eq 2 ] || { echo "usage: image-plugin-tools.sh <image ref> <out dir>" >&2; exit 2; }
IMAGE="$1"; OUT="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$OUT"

stray=$(docker run --rm --entrypoint sh "$IMAGE" -c \
  "find /app/plugins -name oauth.json -not -path '*/node_modules/*' | wc -l")
[ "$(echo "$stray" | tr -d '[:space:]')" = 0 ] \
  || { echo "image-plugin-tools: the image holds an oauth.json under /app/plugins." >&2; exit 1; }

port=41000
found=0
seen_uids=" "
for dir in "$ROOT"/plugins/*/; do
  slug="$(basename "$dir")"
  found=1
  port=$((port + 1))
  cid=$(docker run -d -p "127.0.0.1:$port:$port" -w "/app/plugins/$slug" --user "plugin-$slug" --entrypoint env "$IMAGE" \
    -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin NODE_ENV=production "PORT=$port" \
    node server/index.js)
  stop() { docker logs "$cid" 2>&1 | tail -20 >&2 || true; docker rm -f "$cid" >/dev/null 2>&1 || true; }
  up=0
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$port/health" 2>/dev/null; then up=1; break; fi
    sleep 0.5
  done
  [ "$up" = 1 ] || { echo "image-plugin-tools: $slug did not answer /health from the image." >&2; stop; exit 1; }
  if ! node "$ROOT/scripts/plugin-tools.mjs" "http://127.0.0.1:$port/mcp" >"$OUT/tools-$slug.json"; then
    echo "image-plugin-tools: could not list $slug's tools." >&2; stop; exit 1
  fi
  # Who the plugin process itself runs as, read from the process and not from
  # the request: process 1 in this container is `env`, which became node.
  uid=$(docker exec "$cid" sh -c 'awk "/^Uid:/ {print \$2}" /proc/1/status' | tr -d '[:space:]')
  case "$uid" in
    ''|*[!0-9]*|0) echo "image-plugin-tools: $slug ran as uid '$uid', not as a non-root account." >&2; stop; exit 1 ;;
  esac
  case "$seen_uids" in
    *" $uid "*) echo "image-plugin-tools: $slug shares uid $uid with another plugin." >&2; stop; exit 1 ;;
  esac
  seen_uids="$seen_uids$uid "
  if docker exec "$cid" sh -c "touch /app/plugins/$slug/server/.write-probe" 2>/dev/null; then
    echo "image-plugin-tools: $slug's account can write the plugin's own files." >&2; stop; exit 1
  fi
  docker rm -f "$cid" >/dev/null
  count=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tools.length)' "$OUT/tools-$slug.json")
  echo "$slug: $count tools served from the image, as uid $uid"
done
[ "$found" = 1 ] || { echo "image-plugin-tools: no plugin directories found." >&2; exit 1; }
