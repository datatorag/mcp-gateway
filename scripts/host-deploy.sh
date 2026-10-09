#!/bin/bash
# The host's side of a deploy (SCRUM-394). It runs on the production host, as
# root, and is the only thing a deploy request can reach.
#
#   host-deploy request "<line>"     # what the deploy key is forced to run
#   host-deploy previous <surface>   # an operator on the host, GitHub not needed
#   host-deploy status
#   host-deploy --self-test          # anywhere; touches no container
#
# A request line is one of exactly these, single spaces, nothing else:
#   deploy <surface> <sha> <digest>
#   rollback <surface> <sha>
#   status
#
# It is installed by a person, to a fixed path, from a commit on main. A deploy
# never updates it: a deploy that could replace the thing that validates
# deploys would make the validation decorative. Its answer to a request starts
# with its own checksum, so a copy that has drifted from the repository is seen.
#
# What it guarantees for `deploy`:
#   - The surface is in the list in surface_spec. The sha is 40 hex characters
#     and the digest is a sha256. Anything else is refused before anything runs.
#   - The image is pulled by digest, from this repository's registry namespace
#     and from nowhere else. A tag is never read.
#   - The commit is on main, and it is NEWER than the one running: both are
#     asked of GitHub's public API, and no answer is a refusal. So a stolen
#     deploy key cannot put an old image back, except the one step `rollback`
#     allows.
#   - The image's revision label is the sha that was asked for.
#   - After the start, the container is running the requested image and the
#     surface itself reports that sha (ctr_sha says how, per surface). If
#     either is not so, what was running is started again and the record is
#     left as it was. "What was running" is asked of the host: the image
#     the record names as current when that is what the container is on, and
#     otherwise the image the container was found on, whoever started it.
#   - "Newer than the one running" is judged the same way: against the commit
#     the running container reports when it is not the recorded image. If such
#     a container cannot say which commit it is, the request is refused. So
#     is any request when the host cannot be asked what is running, and any
#     request for a surface marked `keep` that has no container at all.
#   - A surface marked `keep` in surface_spec is never taken down by this
#     script. It is recreated on a new image or left alone.
#   - The record (current and previous image per surface) is written only
#     after that check passes.
#   - KEEP images per surface stay on the host, the current one and its
#     previous always among them, so a rollback works with the registry
#     unreachable. A request that is refused or fails removes only an image
#     that same request brought in, never one that was there.
#
# What it guarantees for `rollback`: it starts the image recorded as previous,
# only if that is the commit named, and only while the surface is still on
# the image this script deployed last. Nothing is pulled and nothing is asked
# of GitHub.
#
# What it does NOT do, so its output is not read as more than it is:
#   - It cannot tell who published an image. Anyone who can push to this
#     repository's registry namespace can publish one whose label names any
#     commit. Choosing the digest from the build that ran on main is the
#     deploy workflow's job (release.yml). So the deploy key together with
#     push access to a branch is enough to start an image of one's choosing,
#     under the limits of the surface's compose file, on the network the
#     gateway is on.
#   - It does not stop a holder of the key from using up the hour's
#     unauthenticated reads of GitHub, after which deploys are refused until
#     the hour is over. A rollback asks GitHub nothing and still works.
#   - It does not render an env file, run a migration or touch a database.
#     The gateway's compose file reads an env file that is already on the
#     host and is kept current by a person; this script only checks it is
#     there. A commit that needs a migration needs it run first, by hand.
#   - It does not install or update the compose files it uses. A person does.
#     `status` prints each one's checksum so the deploy workflow can compare
#     it with the copy on main before it asks for anything.
#   - `rollback` returns only to the image this script itself replaced. A
#     deploy over an image something else started (the first time this script
#     deploys a surface, or after the scripted path was used) records no
#     previous at all: not that image, and not the older one the record still
#     named. The way back from such a deploy is whatever started that image.
#   - It does not stop a holder of the key from restarting a surface by asking
#     for a newer commit that then fails its check. What was running is put
#     back each time.
#   - On a surface that may be absent (the canary), when the container is gone
#     the record is all there is: a commit is ordered against the recorded
#     one, and a failed start is put back to the recorded image, although
#     nothing was running. A surface marked `keep` never gets that far.
#   - `previous` and `rollback` do not check that the older image is a good
#     idea. They are the undo.
set -euo pipefail
# The path, the locale the patterns below are read in, and the variables
# docker and curl would take a daemon, a config or a proxy from are set or
# cleared here. That is a second line: the first is sudo, which must reset
# the environment before this script starts.
PATH=/usr/sbin:/usr/bin:/sbin:/bin
LC_ALL=C
HOME=/root
export PATH LC_ALL HOME
unset DOCKER_HOST DOCKER_CONFIG DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH \
  COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy \
  CURL_CA_BUNDLE SSL_CERT_FILE SSL_CERT_DIR
umask 022

REPO="datatorag/mcp-gateway"
REGISTRY_PREFIX="ghcr.io/$REPO"
API="https://api.github.com/repos/$REPO"
ROOT="/opt/datatorag-deploy"
STATE_DIR="$ROOT/state"
KEEP=5
SELF="$0"

SURFACES="canary gateway"
# <surface> -> "<compose file> <compose project> <service> <image variable>
#               <env file, or -> <down|keep>".
# The last field says what a failed first start may do when nothing was
# running before: `down` removes the project again, `keep` never does.
# A new surface is its name in SURFACES, one line here, one compose file, and
# a case in ctr_sha.
surface_spec() {
  case "$1" in
    canary) echo "$ROOT/compose/canary.yml dtr-canary canary CANARY_IMAGE - down" ;;
    # The gateway keeps the compose project it has always had, so its
    # container, its plugin volume and its network are the same ones. Its env
    # file stays where the scripted deploy path left it.
    gateway) echo "$ROOT/compose/gateway.yml docker gateway GATEWAY_IMAGE /home/ubuntu/datatorag-mcp/.env keep" ;;
    *) return 1 ;;
  esac
}

valid_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
valid_digest() { [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]]; }
valid_image_id() { [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]]; } # a local image, by its id
image_ref() { echo "$REGISTRY_PREFIX/$1@$2"; } # <surface> <digest>

# Sets REQ_ACTION, REQ_SURFACE, REQ_SHA, REQ_DIGEST, or fails. The line must
# be exactly what this function would print back: no second space, no tab, no
# newline, no character outside the ones a request is made of.
parse_request() {
  local line="$1" a="" b="" c="" d="" extra=""
  REQ_ACTION="" REQ_SURFACE="" REQ_SHA="" REQ_DIGEST=""
  case "$line" in "" | *[!a-z0-9:\ ]*) return 1 ;; esac
  read -r a b c d extra <<<"$line"
  [ -z "$extra" ] || return 1
  case "$a" in
    status)
      [ "$line" = "status" ] || return 1 ;;
    rollback)
      [ "$line" = "rollback $b $c" ] || return 1
      surface_spec "$b" >/dev/null && valid_sha "$c" || return 1 ;;
    deploy)
      [ "$line" = "deploy $b $c $d" ] || return 1
      surface_spec "$b" >/dev/null && valid_sha "$c" && valid_digest "$d" || return 1 ;;
    *) return 1 ;;
  esac
  REQ_ACTION="$a" REQ_SURFACE="$b" REQ_SHA="$c" REQ_DIGEST="$d"
}

# ---- everything that touches the world; the self-test replaces these --------

script_sum() { sha256sum "$SELF" | cut -d' ' -f1; }
file_sum() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
readable() { [ -r "$1" ]; }
record() { logger -t host-deploy -- "$1" 2>/dev/null || true; } # the host's own log
take_lock() {
  exec 9>"$STATE_DIR/lock"
  flock -n 9
}
# One public, unauthenticated read. Bounded in time and in size. -q first: no
# curlrc is read.
api() {
  curl -q --fail --silent --show-error --proto '=https' --tlsv1.2 \
    --max-time 20 --max-filesize 20000000 \
    -H 'Accept: application/vnd.github+json' "$API/$1"
}
# Every docker call that waits on something outside this script has a limit,
# so a registry or a container that never answers cannot hold the lock.
img_pull() { timeout 600 docker pull --quiet "$1" >/dev/null; }
img_present() { docker image inspect "$1" >/dev/null 2>&1; }
img_label() { docker image inspect "$1" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'; }
img_remove() { docker image rm "$1" >/dev/null 2>&1; }
compose_for() { # <surface> <image reference> <compose arguments...>
  local file project service var envfile fresh surface="$1" ref="$2"
  shift 2
  read -r file project service var envfile fresh <<<"$(surface_spec "$surface")"
  export "$var=$ref"
  local base=(--project-name "$project" --file "$file")
  if [ "$envfile" != - ]; then base+=(--env-file "$envfile"); fi
  # --no-build and --pull never: this script decided what runs, by digest,
  # and compose must not fetch or build anything on its own.
  case "$1" in
    up) timeout 180 docker compose "${base[@]}" up --detach --no-build --pull never "$service" ;;
    down) timeout 180 docker compose "${base[@]}" down ;;
    # The service's own containers, stopped ones included, and not the
    # one-off containers `compose run` leaves behind. Asked of docker by
    # label, so it needs neither the compose file nor the env file.
    ps) timeout 30 docker ps --all --quiet \
      --filter "label=com.docker.compose.project=$project" \
      --filter "label=com.docker.compose.service=$service" \
      --filter "label=com.docker.compose.oneoff=False" ;;
  esac
}
svc_up() { compose_for "$1" "$2" up; }           # <surface> <image reference>
svc_down() { compose_for "$1" "$2" down; }       # only this surface's project
# The ids of the surface's containers, stopped ones included: none, one, or
# (which is never right) more. It fails when the host could not be asked;
# that is not "none".
svc_container() { compose_for "$1" "$2" ps; }
ctr_image() { docker inspect "$1" --format '{{ .Config.Image }}'; }
ctr_image_id() { docker inspect "$1" --format '{{ .Image }}'; }
ctr_running() { [ "$(docker inspect "$1" --format '{{ .State.Running }}' 2>/dev/null)" = true ]; }
# <surface> <container>: the commit the running surface says it is. It prints
# nothing and fails until the surface answers as healthy.
ctr_sha() {
  case "$1" in
    canary)
      timeout "$ASK_LIMIT" docker exec "$2" node -e \
        "fetch('http://127.0.0.1:8080/health',{signal:AbortSignal.timeout(5000)}).then(r=>r.json()).then(j=>console.log(j.sha)).catch(()=>process.exit(1))" ;;
    # The gateway's /health does not name a commit. The commit is the one its
    # image was built with, read inside the container, and it counts only
    # once the gateway itself answers ok.
    gateway)
      timeout "$ASK_LIMIT" docker exec "$2" node -e \
        "fetch('http://127.0.0.1:80/health',{signal:AbortSignal.timeout(5000)}).then(r=>r.json()).then(j=>{if(j.status!=='ok')process.exit(1);console.log(process.env.GATEWAY_SHA||'')}).catch(()=>process.exit(1))" ;;
  esac
}
# How many seconds a surface has to report its commit after a start. One ask
# is cut off after ASK_LIMIT seconds, inside the container and from outside,
# so the whole wait is at most this plus one ask.
health_seconds() { case "$1" in gateway) echo 120 ;; *) echo 40 ;; esac; }
HEALTH_WAIT=2
ASK_LIMIT=10

# ---- decisions -------------------------------------------------------------

say() { echo "host-deploy: $1"; }
refuse() { say "REFUSED. $1"; record "refused: $1"; exit 3; }
fail() { say "FAILED. $1"; record "failed: $1"; exit 1; }

state_file() { echo "$STATE_DIR/$1.json"; }
# <surface> <jq path>: a value from the record, or nothing.
state_get() {
  local f
  f=$(state_file "$1")
  [ -f "$f" ] || return 0
  jq -r "$2 // empty" "$f"
}
state_check() {
  local f
  f=$(state_file "$1")
  [ ! -f "$f" ] || jq -e 'type == "object"' "$f" >/dev/null 2>&1 \
    || fail "The record for $1 cannot be read. Nothing was changed."
}
state_write() { # <surface> <json>
  local f tmp
  f=$(state_file "$1")
  tmp="$f.new"
  printf '%s\n' "$2" >"$tmp"
  mv "$tmp" "$f"
}

# <sha> <current sha or empty>: refuse unless the commit is on main and, when
# something is running, newer than it.
check_order() {
  local sha="$1" current="$2" main relation
  main=$(api "git/ref/heads/main" | jq -r '.object.sha // empty') || main=""
  valid_sha "$main" || refuse "Could not read main from GitHub, so the commit's place on it is unknown."
  relation=$(api "compare/$sha...$main?per_page=1" | jq -r '.status // empty') || relation=""
  case "$relation" in
    ahead | identical) ;;
    "") refuse "Could not ask GitHub whether $sha is on main." ;;
    *) refuse "$sha is not on main." ;;
  esac
  [ -n "$current" ] || return 0
  relation=$(api "compare/$current...$sha?per_page=1" | jq -r '.status // empty') || relation=""
  case "$relation" in
    ahead) ;;
    "") refuse "Could not ask GitHub whether $sha is newer than what is running." ;;
    *) refuse "$sha is not newer than the commit that is running. Going back is a rollback, and only to the previous image." ;;
  esac
}

# <surface> <image reference> <sha>: start it and prove it is what was asked for.
start_and_check() {
  local surface="$1" ref="$2" sha="$3" out cid answer="" limit until
  limit=$(health_seconds "$surface")
  if ! out=$(svc_up "$surface" "$ref" 2>&1); then
    # Why goes to the host's own log. The answer to the caller is read in a
    # public place and holds only this script's sentences.
    say "The service did not start. The host's log has the reason."
    record "compose: $(printf '%s' "$out" | tail -5 | tr '\n' ' ')"
    return 1
  fi
  cid=$(svc_container "$surface" "$ref" 2>/dev/null | head -1) || cid=""
  [ -n "$cid" ] || { say "No container exists for $surface after the start."; return 1; }
  [ "$(ctr_image "$cid" 2>/dev/null)" = "$ref" ] \
    || { say "The container is not running the requested image."; return 1; }
  until=$((SECONDS + limit))
  while :; do
    answer=$(ctr_sha "$surface" "$cid" 2>/dev/null) && [ "$answer" = "$sha" ] && return 0
    [ "$SECONDS" -lt "$until" ] || break
    sleep "$HEALTH_WAIT"
  done
  say "$surface did not report commit $sha within ${limit}s."
  return 1
}

# <surface> <attempted reference> [<image id found running> <its commit>]:
# put back what was running. When the container that was running was not the
# one the record names (this script never deployed the surface, or something
# else has started it since), that is the image it was found on, by its id.
# Otherwise it is what the record says is current. With neither, nothing was
# running.
put_back() {
  local surface="$1" tried="$2" found_id="${3:-}" found_sha="${4:-}" sha digest back fresh
  sha=$(state_get "$surface" .current.sha)
  digest=$(state_get "$surface" .current.digest)
  if [ -n "$found_id" ]; then
    back="$found_id" sha="$found_sha"
  elif [ -n "$digest" ]; then
    back=$(image_ref "$surface" "$digest")
  else
    fresh=$(surface_spec "$surface" | cut -d' ' -f6)
    if [ "$fresh" = down ]; then
      svc_down "$surface" "$tried" >/dev/null 2>&1 || true
      say "Nothing was running before, so $surface was stopped again."
    else
      say "Nothing was running before. $surface is left as the failed start left it and needs a person on the host."
      record "nothing to put back for $surface"
    fi
    return 0
  fi
  if start_and_check "$surface" "$back" "$sha"; then
    say "Put back: $surface is running $sha again."
  else
    say "COULD NOT PUT BACK $surface. It needs a person on the host."
    record "could not put back $surface"
  fi
}

# <surface>: refuse unless a person has put this surface's files on the host.
check_installed() {
  local file project service var envfile fresh
  read -r file project service var envfile fresh <<<"$(surface_spec "$1")"
  readable "$file" || refuse "This host has no compose file for $1. A person installs it. Nothing was changed."
  [ "$envfile" = - ] || readable "$envfile" \
    || refuse "This host has no env file for $1. Nothing was changed."
}

# <surface> <any image reference>: what is on the host for this surface now.
# This is asked of the host, not of the record. The record says what this
# script last deployed; something else (the scripted path, a person) may have
# started a different image since, or the script may never have deployed this
# surface.
#
# Sets LOOK_CID (the container, or empty), LOOK_UP (yes when it is running),
# and, when the container is NOT on the image the record names as current,
# LOOK_FOUND_ID and LOOK_FOUND_SHA: its image and the commit it reports.
#
# Every question here that gets no answer is a refusal: the host could not be
# asked; there is more than one container; a surface marked `keep` has no
# container at all; a container on an image this script did not start cannot
# say which commit it is.
look() {
  local surface="$1" out on digest fresh
  LOOK_CID="" LOOK_UP=no LOOK_FOUND_ID="" LOOK_FOUND_SHA=""
  out=$(svc_container "$surface" "$2" 2>/dev/null) \
    || refuse "Could not ask this host what is running for $surface. Nothing was changed."
  [ "$(grep -c . <<<"$out")" -le 1 ] \
    || refuse "$surface has more than one container on this host. Nothing was changed until a person has looked."
  LOOK_CID=$(head -1 <<<"$out")
  if [ -z "$LOOK_CID" ]; then
    fresh=$(surface_spec "$surface" | cut -d' ' -f6)
    [ "$fresh" = down ] \
      || refuse "$surface has no container on this host. A person starts it; this script only replaces one. Nothing was changed."
    return 0
  fi
  if ctr_running "$LOOK_CID"; then LOOK_UP=yes; fi
  on=$(ctr_image "$LOOK_CID" 2>/dev/null) || on=""
  digest=$(state_get "$surface" .current.digest)
  if [ -z "$digest" ] || [ "$on" != "$(image_ref "$surface" "$digest")" ]; then
    LOOK_FOUND_ID=$(ctr_image_id "$LOOK_CID" 2>/dev/null) || LOOK_FOUND_ID=""
    LOOK_FOUND_SHA=$(ctr_sha "$surface" "$LOOK_CID" 2>/dev/null) || LOOK_FOUND_SHA=""
    valid_image_id "$LOOK_FOUND_ID" && valid_sha "$LOOK_FOUND_SHA" \
      || refuse "$surface is on an image this script did not start, and it does not say which commit it is. Nothing was changed."
  fi
}

do_deploy() {
  local surface="$1" sha="$2" digest="$3" ref current current_digest started=$SECONDS
  ref=$(image_ref "$surface" "$digest")
  check_installed "$surface"
  state_check "$surface"
  current=$(state_get "$surface" .current.sha)
  current_digest=$(state_get "$surface" .current.digest)

  # A container that is not on the recorded image is "found": the new commit
  # must be newer than the commit IT reports, and a failed start is put back
  # to ITS image.
  look "$surface" "$ref"
  local found_id="$LOOK_FOUND_ID" found_sha="$LOOK_FOUND_SHA" running="$current"
  if [ -n "$found_id" ]; then running="$found_sha"; fi

  if [ -z "$found_id" ] && [ "$current" = "$sha" ] && [ "$current_digest" = "$digest" ]; then
    if [ "$LOOK_UP" = yes ]; then
      say "OK. $surface is already running $sha. Nothing was changed."
      return 0
    fi
    # The recorded image, in a container that exists and is stopped: start it
    # again, and GitHub is not asked. With no container at all there is
    # nothing on the host that agrees with the record, so the commit is
    # ordered like any other, and the recorded one is then "not newer".
    [ -n "$LOOK_CID" ] || check_order "$sha" "$running"
  else
    check_order "$sha" "$running"
  fi

  # An image that was already here may be the one a rollback needs. Only an
  # image this request brings in is this request's to remove.
  local brought=1
  if img_present "$ref"; then brought=0; fi
  img_pull "$ref" 2>/dev/null || fail "Could not pull the image for $surface by its digest. Nothing was changed."
  local label
  label=$(img_label "$ref" 2>/dev/null) || label=""
  if [ "$label" != "$sha" ]; then
    if [ "$brought" = 1 ]; then img_remove "$ref" || true; fi
    refuse "The image's revision label is not $sha. Nothing was changed."
  fi
  local pulled=$((SECONDS - started))

  if ! start_and_check "$surface" "$ref" "$sha"; then
    put_back "$surface" "$ref" "$found_id" "$found_sha"
    if [ "$brought" = 1 ]; then img_remove "$ref" || true; fi
    fail "$surface was not left running $sha. The record is unchanged."
  fi

  local f old new dropped d
  f=$(state_file "$surface")
  old=$(cat "$f" 2>/dev/null) || old=""
  [ -n "$old" ] || old="null"
  # kept: newest first, one entry per digest, the first KEEP of them.
  # previous: what this deploy replaced, and only if that was the recorded
  # image. Over an image something else started, the recorded current is NOT
  # what was replaced, and may be far older than it, so there is no previous
  # and no rollback until the next deploy.
  local over_found=false
  if [ -n "$found_id" ]; then over_found=true; fi
  new=$(jq -n --arg sha "$sha" --arg digest "$digest" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson keep "$KEEP" --argjson old "$old" --argjson found "$over_found" '
      ($old // {}) as $o
      | (if $found then null
         elif ($o.current // null) != null and $o.current.digest != $digest
         then $o.current else ($o.previous // null) end) as $prev
      # The new current and its previous go first, so the two images a
      # rollback and a put-back need are never among the ones dropped,
      # however often a commit has been rolled back to.
      | ([{sha: $sha, digest: $digest}]
         + (if $prev == null then [] else [{sha: $prev.sha, digest: $prev.digest}] end)
         + ($o.kept // [])
         | reduce .[] as $e ([]; if any(.[]; .digest == $e.digest) then . else . + [$e] end)) as $all
      | { current: {sha: $sha, digest: $digest, at: $at},
          previous: $prev,
          kept: $all[0:$keep],
          dropped: $all[$keep:] }')
  dropped=$(jq -r '.dropped[].digest' <<<"$new")
  state_write "$surface" "$(jq 'del(.dropped)' <<<"$new")"
  for d in $dropped; do
    img_remove "$(image_ref "$surface" "$d")" || true
  done
  record "deployed $surface $sha $digest"
  if [ -n "$found_id" ]; then
    say "$surface was running $found_sha, on an image this script did not start. That image is not recorded, so there is no rollback until the next deploy."
  fi
  # previous= in the answer is what the record now holds as the way back.
  local replaced
  replaced=$(state_get "$surface" .previous.sha)
  replaced="${replaced:-none}"
  say "OK. deploy $surface sha=$sha digest=$digest previous=$replaced pull=${pulled}s total=$((SECONDS - started))s"
}

do_rollback() {
  local surface="$1" sha="$2" prev prev_digest ref cur cur_digest started=$SECONDS
  check_installed "$surface"
  state_check "$surface"
  prev=$(state_get "$surface" .previous.sha)
  prev_digest=$(state_get "$surface" .previous.digest)
  cur=$(state_get "$surface" .current.sha)
  cur_digest=$(state_get "$surface" .current.digest)
  [ -n "$prev" ] || refuse "No previous image is recorded for $surface."
  [ "$prev" = "$sha" ] || refuse "The previous image of $surface is not commit $sha."
  ref=$(image_ref "$surface" "$prev_digest")
  # A rollback is one step back from the image THIS script deployed. If
  # something else has started another image since, the record no longer
  # describes what is running, and going to its "previous" could be a long way
  # back from there. The way back from that image is whatever started it.
  look "$surface" "$ref"
  [ -z "$LOOK_FOUND_ID" ] \
    || refuse "$surface is running $LOOK_FOUND_SHA, on an image this script did not start. The record's previous image is not one step back from that. Nothing was changed."
  img_present "$ref" || refuse "The previous image of $surface is no longer on this host."

  if ! start_and_check "$surface" "$ref" "$prev"; then
    put_back "$surface" "$ref"
    fail "$surface was not left running $prev. The record is unchanged."
  fi
  local f
  f=$(state_file "$surface")
  state_write "$surface" "$(jq --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{current: (.previous + {at: $at}), previous: .current, kept: .kept}' "$f")"
  record "rolled back $surface to $prev $prev_digest"
  say "OK. rollback $surface sha=$prev digest=$prev_digest previous=$cur total=$((SECONDS - started))s"
}

do_status() {
  local s f sum
  for s in $SURFACES; do
    # The compose file a person installed for this surface, by checksum, so a
    # copy that is not the repository's is seen before a deploy is asked for.
    sum=$(file_sum "$(surface_spec "$s" | cut -d' ' -f1)") || sum=""
    say "compose $s ${sum:-none}"
    f=$(state_file "$s")
    if [ -f "$f" ]; then
      say "$s $(jq -c '{current: .current, previous: .previous, kept: (.kept | length)}' "$f")"
    else
      say "$s has never been deployed by this script."
    fi
  done
}

handle_request() {
  say "script $(script_sum)"
  parse_request "$1" || refuse "Not a request this host accepts."
  if [ "$REQ_ACTION" = status ]; then
    do_status
    return
  fi
  take_lock || refuse "Another deploy is running on this host."
  case "$REQ_ACTION" in
    deploy) do_deploy "$REQ_SURFACE" "$REQ_SHA" "$REQ_DIGEST" ;;
    rollback) do_rollback "$REQ_SURFACE" "$REQ_SHA" ;;
  esac
}

# ---- self-test: the decisions, against a made-up host -----------------------

self_test() {
  local failed=0 T out rc
  T=$(mktemp -d)
  STATE_DIR="$T/state"
  mkdir "$STATE_DIR"
  : >"$T/order" # commits on main, oldest first
  : >"$T/registry" # "<digest> <label>" the registry would serve
  : >"$T/local" # digests on the host
  : >"$T/running" # the digest that is running
  : >"$T/pulls"
  : >"$T/downs"
  health_seconds() { echo 0; } # one ask
  HEALTH_WAIT=0

  sha_n() { printf '%040d' "$1"; }
  dig_n() { printf 'sha256:%064d' "$1"; }
  on_main() { sha_n "$1" >>"$T/order"; echo >>"$T/order"; }
  publish() { echo "$(dig_n "$1") $(sha_n "${2:-$1}")" >>"$T/registry"; } # <n> [<n the label claims>]

  script_sum() { echo "self-test"; }
  file_sum() { [ ! -e "$T/not-installed" ] && echo "sum-of-${1##*/}"; }
  readable() { [ ! -e "$T/not-installed" ]; }
  record() { :; }
  take_lock() { [ ! -e "$T/locked" ]; }
  api() {
    [ ! -e "$T/api-down" ] || return 22
    case "$1" in
      git/ref/heads/main) printf '{"object":{"sha":"%s"}}\n' "$(tail -1 "$T/order")" ;;
      compare/*)
        local pair a b ia ib
        pair="${1#compare/}"; pair="${pair%%\?*}"
        a="${pair%%...*}"; b="${pair##*...}"
        ia=$(grep -n "^$a\$" "$T/order" | cut -d: -f1) || ia=""
        ib=$(grep -n "^$b\$" "$T/order" | cut -d: -f1) || ib=""
        if [ -z "$ia" ] || [ -z "$ib" ]; then echo '{"status":"diverged"}'
        elif [ "$ib" -gt "$ia" ]; then echo '{"status":"ahead"}'
        elif [ "$ib" -eq "$ia" ]; then echo '{"status":"identical"}'
        else echo '{"status":"behind"}'; fi ;;
      *) return 22 ;;
    esac
  }
  digest_of() { echo "${1##*@}"; }
  img_pull() {
    grep -q "^$(digest_of "$1") " "$T/registry" || return 1
    echo "$1" >>"$T/pulls"
    grep -qx "$(digest_of "$1")" "$T/local" || digest_of "$1" >>"$T/local"
  }
  img_present() { grep -qx "$(digest_of "$1")" "$T/local"; }
  img_label() { grep "^$(digest_of "$1") " "$T/registry" | cut -d' ' -f2; }
  img_remove() { grep -vx "$(digest_of "$1")" "$T/local" >"$T/local.new" || true; mv "$T/local.new" "$T/local"; }
  svc_up() {
    [ ! -e "$T/up-fails" ] || return 1
    img_present "$2" || return 1
    digest_of "$2" >"$T/running"
    echo "$2" >"$T/running-ref"
    rm -f "$T/stopped" # a start leaves it running
  }
  svc_down() { : >"$T/running"; echo "$1" >>"$T/downs"; }
  svc_container() {
    [ ! -e "$T/ps-fails" ] || return 1
    if [ -s "$T/running" ]; then echo "container"; fi
    if [ -e "$T/second-container" ]; then echo "another"; fi
  }
  ctr_running() { [ ! -e "$T/stopped" ]; }
  ctr_image() { cat "$T/running-ref"; }
  ctr_image_id() { cat "$T/running"; } # the made-up host's image ids are its digests
  ctr_sha() {
    [ ! -e "$T/stopped" ] || return 1
    [ "$(cat "$T/running")" != "$(cat "$T/sick" 2>/dev/null)" ] || return 1
    img_label "x@$(cat "$T/running")"
  }

  ask() { # <request line>: sets out and rc
    if out=$(handle_request "$1" 2>&1); then rc=0; else rc=$?; fi
  }
  expect() { # <description> <wanted rc> <text the output must hold> <request line>
    ask "$4"
    if [ "$rc" != "$2" ] || ! grep -Fq -- "$3" <<<"$out"; then
      echo "host-deploy self-test FAILED: $1 (rc $rc): $(tail -1 <<<"$out")"
      failed=1
    fi
  }
  is() { # <description> <got> <wanted>
    [ "$2" = "$3" ] || { echo "host-deploy self-test FAILED: $1: got '$2', wanted '$3'"; failed=1; }
  }
  running() { cat "$T/running"; }
  cur() { state_get "${1:-canary}" .current.sha; }
  prev() { state_get "${1:-canary}" .previous.sha; }
  downs() { wc -l <"$T/downs" | tr -d ' '; }
  # Something this script did not start is running image <n>.
  found_running() { echo "$(dig_n "$1")" | tee -a "$T/local" "$T/running-ref" >"$T/running"; }

  local s1 d1 n
  s1=$(sha_n 1); d1=$(dig_n 1)
  # A request is refused unless it is exactly a request.
  local bad
  for bad in \
    "" "deploy" "deploy canary" "deploy canary $s1" "deploy canary $s1 $d1 x" \
    "deploy plugins $s1 $d1" "deploy ../canary $s1 $d1" "deploy canary ${s1%?} $d1" \
    "deploy canary main $d1" "deploy canary $s1 ${d1#sha256:}" "deploy canary $s1 sha512:${d1#sha256:}" \
    "deploy  canary $s1 $d1" " deploy canary $s1 $d1" "deploy canary $s1 $d1 " \
    "deploy canary $s1 $d1; id" "deploy canary $s1 \$(id)" "deploy canary $s1 $d1"$'\n'"status" \
    "deploy canary $s1"$'\t'"$d1" "DEPLOY canary $s1 $d1" "rollback canary" "rollback canary $s1 $d1" \
    "rollback plugins $s1" "status now" "previous canary" "--self-test" "shell" "bash -i"; do
    expect "a malformed request is refused" 3 "Not a request this host accepts." "$bad"
  done
  is "a refused request starts nothing" "$(running)" ""

  for n in 1 2 3 4 5 6 7 8; do on_main "$n"; publish "$n"; done

  expect "a first deploy" 0 "OK. deploy canary sha=$s1 digest=$d1 previous=none" "deploy canary $s1 $d1"
  is "the first deploy is running" "$(running)" "$d1"
  is "the first deploy is recorded" "$(cur)/$(prev)" "$s1/"
  expect "the same deploy again changes nothing" 0 "already running" "deploy canary $s1 $d1"
  expect "a newer commit deploys" 0 "previous=$s1" "deploy canary $(sha_n 2) $(dig_n 2)"
  is "current and previous after the second deploy" "$(cur)/$(prev)" "$(sha_n 2)/$s1"

  expect "an older commit is refused" 3 "not newer" "deploy canary $s1 $d1"
  is "a refused deploy leaves what was running" "$(running)" "$(dig_n 2)"
  is "a refused deploy leaves the record" "$(cur)/$(prev)" "$(sha_n 2)/$s1"

  publish 90 # an image for a commit that is not on main
  expect "a commit that is not on main is refused" 3 "is not on main" "deploy canary $(sha_n 90) $(dig_n 90)"
  # A well-formed request must not be a way to delete the image a rollback
  # needs: the previous image, asked for under a newer commit's name.
  expect "the previous image under another commit's name is refused" 3 "revision label" "deploy canary $(sha_n 3) $d1"
  is "and the previous image is still on the host" "$(grep -c "$d1" "$T/local")" "1"
  publish 91 3 # digest 91 holds an image whose label says commit 3
  expect "an image labelled for another commit is refused" 3 "revision label" "deploy canary $(sha_n 4) $(dig_n 91)"
  is "the mislabelled image is not kept" "$(grep -c "$(dig_n 91)" "$T/local")" "0"
  expect "an image the registry does not have fails" 1 "Could not pull" "deploy canary $(sha_n 3) $(dig_n 77)"
  is "still running the second deploy" "$(running)" "$(dig_n 2)"

  touch "$T/api-down"
  expect "no answer from GitHub is a refusal" 3 "Could not read main" "deploy canary $(sha_n 3) $(dig_n 3)"
  rm "$T/api-down"

  dig_n 3 >"$T/sick"
  expect "a surface that does not report its commit fails the deploy" 1 "The record is unchanged" "deploy canary $(sha_n 3) $(dig_n 3)"
  is "the image that was running is put back" "$(running)" "$(dig_n 2)"
  is "the image that failed is not left on the host" "$(grep -c "$(dig_n 3)" "$T/local")" "0"
  is "the record is as it was" "$(cur)/$(prev)" "$(sha_n 2)/$s1"
  rm "$T/sick"
  touch "$T/up-fails"
  expect "a service that does not start fails the deploy" 1 "The record is unchanged" "deploy canary $(sha_n 3) $(dig_n 3)"
  rm "$T/up-fails"
  is "and nothing else is running" "$(running)" "$(dig_n 2)"

  touch "$T/locked"
  expect "a second deploy at the same time is refused" 3 "Another deploy is running" "deploy canary $(sha_n 3) $(dig_n 3)"
  rm "$T/locked"

  # Rollback: only to the previous image, with nothing pulled and GitHub not asked.
  expect "a rollback to a commit that is not the previous one is refused" 3 "is not commit" "rollback canary $(sha_n 3)"
  : >"$T/pulls"
  touch "$T/api-down"
  expect "a rollback to the previous image" 0 "OK. rollback canary sha=$s1" "rollback canary $s1"
  rm "$T/api-down"
  is "the rollback pulled nothing" "$(wc -l <"$T/pulls" | tr -d ' ')" "0"
  is "the previous image is running" "$(running)" "$d1"
  is "current and previous swapped" "$(cur)/$(prev)" "$s1/$(sha_n 2)"
  expect "forward again" 0 "previous=$s1" "deploy canary $(sha_n 2) $(dig_n 2)"
  is "current and previous after going forward" "$(cur)/$(prev)" "$(sha_n 2)/$s1"

  # A commit that is rolled back to again and again must not sink out of the
  # kept images: after each round it is the previous one, and it stays.
  local round
  for round in 3 4 5 6; do
    expect "round $round: back to the first commit" 0 "OK. rollback canary sha=$s1" "rollback canary $s1"
    expect "round $round: forward to a newer one" 0 "previous=$s1" "deploy canary $(sha_n "$round") $(dig_n "$round")"
  done
  is "the commit rolled back to four times is still on the host" "$(grep -c "$d1" "$T/local")" "1"
  expect "and can be rolled back to a fifth time" 0 "OK. rollback canary sha=$s1" "rollback canary $s1"
  expect "forward again before the next block" 0 "previous=$s1" "deploy canary $(sha_n 6) $(dig_n 6)"
  : >"$T/local"; rm "$STATE_DIR/canary.json"; : >"$T/running"
  expect "reset: first" 0 "previous=none" "deploy canary $s1 $d1"
  expect "reset: second" 0 "previous=$s1" "deploy canary $(sha_n 2) $(dig_n 2)"

  # Only the newest KEEP images stay, and the two that matter are among them.
  for n in 3 4 5 6 7 8; do
    expect "deploy $n" 0 "OK. deploy" "deploy canary $(sha_n "$n") $(dig_n "$n")"
  done
  is "images kept on the host" "$(grep -c . "$T/local")" "$KEEP"
  is "the oldest image was removed" "$(grep -c "$d1" "$T/local")" "0"
  is "the previous image is still on the host" "$(grep -c "$(dig_n 7)" "$T/local")" "1"
  img_remove "x@$(dig_n 7)"
  expect "a rollback whose image is gone is refused" 3 "no longer on this host" "rollback canary $(sha_n 7)"
  is "and the newest stays running" "$(running)" "$(dig_n 8)"

  # A first deploy that fails leaves nothing running.
  rm "$STATE_DIR/canary.json"; : >"$T/running"
  dig_n 8 >"$T/sick"
  expect "a failed first deploy" 1 "stopped again" "deploy canary $(sha_n 8) $(dig_n 8)"
  is "leaves nothing running" "$(running)" ""
  is "and no record" "$(cur)" ""

  echo "not json" >"$STATE_DIR/canary.json"
  expect "an unreadable record stops everything" 1 "cannot be read" "deploy canary $(sha_n 8) $(dig_n 8)"
  rm "$STATE_DIR/canary.json"

  # A surface a person has not installed is refused before anything runs.
  touch "$T/not-installed"
  expect "a surface with no files on the host is refused" 3 "A person installs it" "deploy canary $(sha_n 8) $(dig_n 8)"
  expect "and so is a rollback of it" 3 "A person installs it" "rollback canary $(sha_n 7)"
  ask "status"
  is "status says the compose file is not there" "$(grep -c 'compose gateway none' <<<"$out")" "1"
  rm "$T/not-installed"
  ask "status"
  is "status names each surface's compose file" "$(grep -c '^host-deploy: compose ' <<<"$out")" "2"

  # The gateway: a surface that is already running, started by something
  # else, the first time this script is asked to deploy it.
  : >"$T/local"; : >"$T/downs"
  found_running 5 # the image a person's deploy left running; it reports commit 5
  expect "the first deploy must be newer than what was found running" 3 "not newer" "deploy gateway $(sha_n 4) $(dig_n 4)"
  is "and what was running still is" "$(running)" "$(dig_n 5)"
  dig_n 6 >"$T/sick"
  expect "a first deploy that fails" 1 "Put back" "deploy gateway $(sha_n 6) $(dig_n 6)"
  is "puts back the image that was found running" "$(running)" "$(dig_n 5)"
  is "never takes the surface down" "$(downs)" "0"
  is "and writes no record" "$(cur gateway)" ""
  rm "$T/sick"
  expect "a first deploy over a running surface" 0 "previous=none" "deploy gateway $(sha_n 6) $(dig_n 6)"
  is "says the image it replaced is not recorded" "$(grep -c 'no rollback until the next deploy' <<<"$out")" "1"
  is "is running" "$(running)" "$(dig_n 6)"
  is "is recorded, with no previous" "$(cur gateway)/$(prev gateway)" "$(sha_n 6)/"
  is "left the image it replaced on the host" "$(grep -c "$(dig_n 5)" "$T/local")" "1"
  expect "there is no rollback after a first deploy" 3 "No previous image" "rollback gateway $(sha_n 5)"
  expect "the second deploy" 0 "previous=$(sha_n 6)" "deploy gateway $(sha_n 7) $(dig_n 7)"
  expect "and then a rollback works" 0 "OK. rollback gateway sha=$(sha_n 6)" "rollback gateway $(sha_n 6)"

  # The record now says commit 6. Then something else (the scripted path)
  # starts a newer image, commit 8. The record is stale; the host is not.
  found_running 8
  touch "$T/api-down"
  expect "asking for the recorded commit is not a way around the ordering" 3 "Could not read main" "deploy gateway $(sha_n 6) $(dig_n 6)"
  rm "$T/api-down"
  expect "the recorded commit is older than what is running" 3 "not newer" "deploy gateway $(sha_n 6) $(dig_n 6)"
  expect "newer than the record is not enough" 3 "not newer" "deploy gateway $(sha_n 7) $(dig_n 7)"
  is "what something else started is still running" "$(running)" "$(dig_n 8)"
  on_main 9; publish 9
  dig_n 9 >"$T/sick"
  expect "a failed deploy over it" 1 "Put back: gateway is running $(sha_n 8)" "deploy gateway $(sha_n 9) $(dig_n 9)"
  is "is put back to what was running, not to the record" "$(running)" "$(dig_n 8)"
  is "and the record is as it was" "$(cur gateway)/$(prev gateway)" "$(sha_n 6)/$(sha_n 7)"
  dig_n 8 >"$T/sick"
  expect "a found image that cannot say its commit is a refusal" 3 "does not say which commit" "deploy gateway $(sha_n 9) $(dig_n 9)"
  is "and it is left running" "$(running)" "$(dig_n 8)"
  rm "$T/sick"
  expect "a newer commit deploys over it" 0 "previous=none" "deploy gateway $(sha_n 9) $(dig_n 9)"
  # What it replaced was 8, which is not recorded. The record's old current,
  # 6, is not one step back from 9 and must not become the way back.
  is "and records no previous: not 8, and not the stale 6" "$(cur gateway)/$(prev gateway)" "$(sha_n 9)/"
  touch "$T/api-down"
  expect "so a rollback to the stale commit is refused" 3 "No previous image" "rollback gateway $(sha_n 6)"
  rm "$T/api-down"
  is "and the new image stays" "$(running)" "$(dig_n 9)"
  is "the gateway was never taken down" "$(downs)" "0"
  # The same with no record at all.
  rm "$STATE_DIR/gateway.json"; found_running 8
  dig_n 8 >"$T/sick"
  expect "with no record, a found image that cannot say its commit is a refusal" 3 "does not say which commit" "deploy gateway $(sha_n 9) $(dig_n 9)"
  rm "$T/sick"

  # The record says 9 and the gateway is on it. Then the scripted path starts
  # commit 10. A rollback is one step back from what THIS script deployed, so
  # it is refused: the record's previous image is not one step back from 10.
  rm -f "$STATE_DIR/gateway.json"; : >"$T/local"; found_running 5
  expect "set up: first deploy" 0 "OK. deploy" "deploy gateway $(sha_n 6) $(dig_n 6)"
  expect "set up: second deploy" 0 "OK. deploy" "deploy gateway $(sha_n 7) $(dig_n 7)"
  on_main 10; publish 10; found_running 10
  touch "$T/api-down"
  expect "a rollback over an image something else started is refused" 3 "did not start" "rollback gateway $(sha_n 6)"
  rm "$T/api-down"
  is "and that image is still running" "$(running)" "$(dig_n 10)"
  is "and the record is as it was" "$(cur gateway)/$(prev gateway)" "$(sha_n 7)/$(sha_n 6)"

  # Not being able to ask what is running is not "nothing is running".
  touch "$T/ps-fails"
  expect "a deploy when the host cannot be asked is refused" 3 "Could not ask this host" "deploy gateway $(sha_n 7) $(dig_n 7)"
  expect "and so is a rollback" 3 "Could not ask this host" "rollback gateway $(sha_n 6)"
  rm "$T/ps-fails"
  is "nothing was touched" "$(running)" "$(dig_n 10)"

  touch "$T/second-container"
  expect "more than one container is a refusal" 3 "more than one container" "deploy gateway $(sha_n 7) $(dig_n 7)"
  rm "$T/second-container"

  # A stopped container is still a container: what it is on still decides.
  touch "$T/stopped"
  expect "a stopped image something else started cannot say its commit" 3 "does not say which commit" "deploy gateway $(sha_n 7) $(dig_n 7)"
  rm "$T/stopped"

  # The gateway is replaced, never created: with no container at all, every
  # request is refused, the recorded commit included, whatever GitHub says.
  : >"$T/running"; : >"$T/downs"
  expect "the recorded commit with no container is refused" 3 "has no container" "deploy gateway $(sha_n 7) $(dig_n 7)"
  expect "a newer commit with no container is refused" 3 "has no container" "deploy gateway $(sha_n 10) $(dig_n 10)"
  expect "a rollback with no container is refused" 3 "has no container" "rollback gateway $(sha_n 6)"
  is "nothing was started" "$(running)" ""
  is "and nothing was taken down" "$(downs)" "0"

  # The canary may be absent. Then nothing on the host agrees with the record,
  # so the recorded commit is not started again for the asking.
  expect "set up: canary" 0 "OK. deploy" "deploy canary $(sha_n 8) $(dig_n 8)"
  : >"$T/running"
  expect "the recorded commit with the container gone is ordered like any other" 3 "not newer" "deploy canary $(sha_n 8) $(dig_n 8)"
  is "and nothing was started" "$(running)" ""
  rm "$STATE_DIR/canary.json"

  # The recorded image, stopped: starting it again asks GitHub nothing.
  expect "set up: canary" 0 "OK. deploy" "deploy canary $(sha_n 8) $(dig_n 8)"
  touch "$T/stopped"; touch "$T/api-down"
  expect "the recorded image, stopped, is started again" 0 "OK. deploy canary sha=$(sha_n 8)" "deploy canary $(sha_n 8) $(dig_n 8)"
  rm "$T/api-down"
  is "and it is running" "$(running)" "$(dig_n 8)"
  rm "$STATE_DIR/canary.json"; : >"$T/running"
  is "the two surfaces keep separate records" "$(cur)" ""

  rm -rf "$T"
  if [ "$failed" = 1 ]; then exit 2; fi
  echo "host-deploy self-test ok: requests, ordering, put-back, rollback and pruning behave as documented."
}

main() {
  case "${1:-}" in
    --self-test)
      self_test ;;
    request)
      [ "$#" -eq 2 ] || { say "REFUSED. Not a request this host accepts."; exit 3; }
      handle_request "$2" ;;
    status)
      [ "$#" -eq 1 ] || { echo "usage: host-deploy status" >&2; exit 2; }
      handle_request "status" ;;
    previous)
      [ "$#" -eq 2 ] && surface_spec "$2" >/dev/null \
        || { echo "usage: host-deploy previous <surface>" >&2; exit 2; }
      local prev
      prev=$(state_get "$2" .previous.sha)
      [ -n "$prev" ] || { say "REFUSED. No previous image is recorded for $2."; exit 3; }
      handle_request "rollback $2 $prev" ;;
    *)
      echo "usage: host-deploy request \"<line>\" | previous <surface> | status | --self-test" >&2
      exit 2 ;;
  esac
}

main "$@"
