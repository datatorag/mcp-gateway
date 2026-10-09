#!/usr/bin/env bash
# Build one surface's image for one commit, and optionally publish it
# (SCRUM-394). The build workflow runs this; a person can run it too.
#
#   scripts/build-image.sh <surface> <sha> [--push]
#   scripts/build-image.sh --self-test
#
#   <surface>  one of the names in surface_spec below
#   <sha>      the full 40-character commit the image is built from. It must
#              exist in the repository this script is run in.
#
# What it guarantees:
#   - The image is built from that commit's tree, exported into an empty
#     directory. The working directory is never the build context, so nothing
#     modified, untracked or ignored in it can reach an image.
#   - The export is then compared with the commit, file by file, by content
#     hash: every file the commit holds must be there, byte for byte, with the
#     executable bit the commit records, and nothing else. So local git state that reshapes an export (replace refs,
#     attributes, line-ending or filter config) stops the build instead of
#     changing the image. A commit that itself marks files export-ignore is
#     stopped the same way.
#   - The script that builds is the one on disk; the source is the commit. So
#     an old commit builds with today's rules.
#   - The image is named <prefix>/<surface> and tagged with the full sha. There
#     is no `latest` and no other tag.
#   - With --push only: the commit must be on main, meaning an ancestor of
#     refs/remotes/origin/main, spelled in full because a tag or a branch
#     named origin/main would be found first under the short name; the registry is asked
#     first whether the tag exists, and if it does the existing digest is
#     reported and nothing is built or pushed; and the gateway is refused
#     unless every public build value is set, because an image published
#     without them would deploy with its analytics silently off.
#   - The built image's revision label equals <sha>, checked on the image and
#     not assumed from the command line.
#
#   - With --push, and only when THIS run pushed the image: the digest is
#     written to the step's outputs. The workflow keeps it as the run's record
#     of what it published, and a deploy reads that record. A run that found
#     the tag already there records nothing: it did not publish that image
#     and cannot say who did.
#
# The tag check and the push are two steps, not one. The workflow runs one
# build at a time per surface and commit; this script alone does not.
#
# What it does NOT do: deploy anything, or prove the gateway image starts. The
# canary is started and asked for its commit; the gateway needs a database to
# boot and is not started here.
set -euo pipefail

# Replace refs and grafts let a repository answer for a commit with something
# other than that commit. Neither is honoured here.
export GIT_NO_REPLACE_OBJECTS=1
export GIT_GRAFT_FILE=/dev/null/no-graft-file # a path that cannot exist
MAIN_REF="refs/remotes/origin/main"

IMAGE_PREFIX="${IMAGE_PREFIX:-ghcr.io/datatorag/mcp-gateway}"
SOURCE_URL="https://github.com/datatorag/mcp-gateway"
# Compiled into the browser bundle, so public by nature. They come from
# repository variables, never secrets, and reach docker through the
# environment so a value is never on a command line.
GATEWAY_PUBLIC_VALUES="NEXT_PUBLIC_POSTHOG_KEY NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL"

# <surface> -> "<build context> <dockerfile> <name of the commit build-arg>",
# paths relative to the root of the commit's tree. A new surface is one line here.
surface_spec() {
  case "$1" in
    gateway) echo ". apps/gateway/Dockerfile GATEWAY_SHA" ;;
    canary) echo "docker/canary docker/canary/Dockerfile CANARY_SHA" ;;
    *) return 1 ;;
  esac
}

# The registry's own answer that this exact reference does not exist. A
# failed lookup that merely contains the words "not found" (a token endpoint,
# a DNS error) is not that answer.
says_absent() { # <reference> <lookup output>
  grep -Fq "$1: not found" <<<"$2"
}

# <repo> <sha> <dir>: export the commit's tree into the (empty) directory.
export_commit() {
  git -C "$1" archive --format=tar "$2" | tar -x -C "$3"
}

# <repo> <sha> <dir>: succeed only if the directory holds exactly the commit's
# files, each with the content the commit records.
verify_export() {
  python3 - "$1" "$2" "$3" <<'PY'
import hashlib, os, subprocess, sys

repo, sha, root = sys.argv[1:4]
listing = subprocess.run(
    ["git", "-C", repo, "ls-tree", "-r", "-z", sha], check=True, capture_output=True
).stdout
want = {}
for entry in listing.split(b"\0"):
    if not entry:
        continue
    meta, path = entry.split(b"\t", 1)
    mode, kind, blob = meta.split()
    if kind != b"blob":
        sys.exit("build-image: the commit holds something that is not a file; not built.")
    want[path] = (mode, blob.decode())

def blob_hash(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()

have = set()
rootb = os.fsencode(root)
for base, dirs, files in os.walk(rootb):
    for name in list(dirs):
        full = os.path.join(base, name)
        if os.path.islink(full):
            dirs.remove(name)
            files.append(name)
    for name in files:
        full = os.path.join(base, name)
        rel = os.path.relpath(full, rootb)
        have.add(rel)
        if rel not in want:
            sys.exit("build-image: the export holds a file the commit does not; not built.")
        mode, blob = want[rel]
        if os.path.islink(full):
            data = os.readlink(full) if mode == b"120000" else None
        else:
            data = open(full, "rb").read() if mode != b"120000" else None
        if data is None or blob_hash(data) != blob:
            sys.exit("build-image: an exported file differs from the commit; not built.")
        if mode != b"120000" and bool(os.stat(full).st_mode & 0o100) != (mode == b"100755"):
            sys.exit("build-image: an exported file's executable bit differs from the commit; not built.")
if have != set(want):
    sys.exit("build-image: the export is missing a file the commit holds; not built.")
PY
}

valid_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

# Names of the public build values that are unset or empty, space separated.
missing_public_values() {
  local name missing=""
  for name in $GATEWAY_PUBLIC_VALUES; do
    [ -n "${!name:-}" ] || missing="$missing $name"
  done
  echo "${missing# }"
}

note() { # one line to the log, and to the job summary when there is one
  echo "$1"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$1" >>"$GITHUB_STEP_SUMMARY"; fi
}

self_test() {
  local failed=0
  check() { # <description> <command...>: the command must succeed
    local what="$1"
    shift
    "$@" >/dev/null 2>&1 || { echo "build-image self-test FAILED: $what"; failed=1; }
  }
  refuse() { # <description> <command...>: the command must fail
    local what="$1"
    shift
    if "$@" >/dev/null 2>&1; then echo "build-image self-test FAILED: $what"; failed=1; fi
  }
  check "the gateway is a surface" surface_spec gateway
  check "the canary is a surface" surface_spec canary
  refuse "an unknown surface is refused" surface_spec plugins
  refuse "an empty surface is refused" surface_spec ""
  refuse "a surface with a path in it is refused" surface_spec "../gateway"
  check "a full sha is accepted" valid_sha "0123456789abcdef0123456789abcdef01234567"
  refuse "a short sha is refused" valid_sha "0123456"
  refuse "a branch name is refused" valid_sha "main"
  refuse "an uppercase sha is refused" valid_sha "0123456789ABCDEF0123456789ABCDEF01234567"
  refuse "a sha with a suffix is refused" valid_sha "0123456789abcdef0123456789abcdef01234567 --push"
  refuse "a sha followed by a newline and more is refused" valid_sha $'0123456789abcdef0123456789abcdef01234567\nx'
  local r="registry.invalid/x/canary:0123456789abcdef0123456789abcdef01234567"
  check "the registry saying the reference is absent is read as absent" says_absent "$r" "ERROR: $r: not found"
  refuse "a token endpoint's 404 is not read as absent" says_absent "$r" "failed to fetch oauth token: unexpected status from GET request to https://registry.invalid/token: 404 Not Found"
  refuse "a DNS failure is not read as absent" says_absent "$r" "proxyconnect tcp: lookup registry.invalid: host not found"
  refuse "another reference being absent is not read as absent" says_absent "$r" "ERROR: registry.invalid/x/gateway:0123456789abcdef0123456789abcdef01234567: not found"
  refuse "a refusal is not read as absent" says_absent "$r" "403 Forbidden"
  local tmp out at
  tmp=$(mktemp -d)
  git init -q "$tmp/repo"
  mkdir "$tmp/repo/sub"
  printf 'one\n' >"$tmp/repo/a.txt"
  printf 'two\n' >"$tmp/repo/sub/b.txt"
  ln -s a.txt "$tmp/repo/link"
  git -C "$tmp/repo" add -A
  git -C "$tmp/repo" -c user.name=t -c user.email=t@example.invalid commit -q -m one
  at=$(git -C "$tmp/repo" rev-parse HEAD)
  fresh() { out="$tmp/out"; rm -rf "$out"; mkdir "$out"; export_commit "$tmp/repo" "$at" "$out"; }
  fresh
  check "an untouched export matches its commit" verify_export "$tmp/repo" "$at" "$out"
  printf 'changed\n' >"$out/a.txt"
  refuse "a changed file is caught" verify_export "$tmp/repo" "$at" "$out"
  fresh; rm "$out/sub/b.txt"
  refuse "a missing file is caught" verify_export "$tmp/repo" "$at" "$out"
  fresh; printf 'x\n' >"$out/sub/extra.txt"
  refuse "an extra file is caught" verify_export "$tmp/repo" "$at" "$out"
  fresh; rm "$out/link"; ln -s sub/b.txt "$out/link"
  refuse "a retargeted link is caught" verify_export "$tmp/repo" "$at" "$out"
  fresh; rm "$out/link"; printf 'one\n' >"$out/link"
  refuse "a link turned into a file is caught" verify_export "$tmp/repo" "$at" "$out"
  fresh; chmod +x "$out/a.txt"
  refuse "a file made executable is caught" verify_export "$tmp/repo" "$at" "$out"
  # Local state that reshapes an export must stop the build, not shape it.
  echo "a.txt export-ignore" >"$tmp/repo/.git/info/attributes"
  fresh
  refuse "a locally ignored file is caught" verify_export "$tmp/repo" "$at" "$out"
  rm "$tmp/repo/.git/info/attributes"
  git -C "$tmp/repo" config core.autocrlf true
  fresh
  refuse "a line-ending conversion is caught" verify_export "$tmp/repo" "$at" "$out"
  git -C "$tmp/repo" config --unset core.autocrlf
  # The short name origin/main must not be what decides "on main".
  git -C "$tmp/repo" update-ref refs/remotes/origin/main "$at"
  git -C "$tmp/repo" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m off-main
  git -C "$tmp/repo" tag origin/main HEAD
  refuse "a tag named origin/main does not put a commit on main" \
    git -C "$tmp/repo" merge-base --is-ancestor "$(git -C "$tmp/repo" rev-parse HEAD)" "$MAIN_REF"
  check "a commit on main is on main" git -C "$tmp/repo" merge-base --is-ancestor "$at" "$MAIN_REF"
  rm -rf "$tmp"
  local got
  got=$(NEXT_PUBLIC_POSTHOG_KEY=x NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL="" NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL=y missing_public_values)
  [ "$got" = "NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL" ] \
    || { echo "build-image self-test FAILED: an empty public value is reported by name"; failed=1; }
  got=$(NEXT_PUBLIC_POSTHOG_KEY=x NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL=y NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_CONVERSION_LABEL=z missing_public_values)
  [ -z "$got" ] || { echo "build-image self-test FAILED: nothing is missing when all are set"; failed=1; }
  if [ "$failed" = 1 ]; then exit 2; fi
  echo "build-image self-test ok: surfaces, shas and public build values are checked as documented."
}

main() {
  if [ "${1:-}" = "--self-test" ]; then
    self_test
    return
  fi
  local surface="${1:-}" sha="${2:-}" push=0
  case "${3:-}" in
    --push) push=1 ;;
    "") ;;
    *) echo "build-image: unknown argument." >&2; exit 2 ;;
  esac
  [ "$#" -le 3 ] || { echo "build-image: too many arguments." >&2; exit 2; }
  [ -n "$surface" ] && [ -n "$sha" ] \
    || { echo "usage: scripts/build-image.sh <surface> <sha> [--push]" >&2; exit 2; }

  local spec context dockerfile sha_arg
  spec=$(surface_spec "$surface") || { echo "build-image: not a surface." >&2; exit 2; }
  read -r context dockerfile sha_arg <<<"$spec"
  valid_sha "$sha" || { echo "build-image: the commit must be a full 40-character sha." >&2; exit 2; }

  git cat-file -e "$sha^{commit}" 2>/dev/null \
    || { echo "build-image: $sha is not a commit in this repository. Fetch it first." >&2; exit 2; }
  git cat-file -e "$sha:$dockerfile" 2>/dev/null \
    || { echo "build-image: the surface '$surface' does not exist at $sha (no $dockerfile)." >&2; exit 1; }
  case "$(git ls-tree "$sha" -- "$dockerfile")" in
    100644\ *|100755\ *) ;;
    *) echo "build-image: REFUSED. $dockerfile is not a regular file at $sha." >&2; exit 1 ;;
  esac

  local image="$IMAGE_PREFIX/$surface" ref
  ref="$image:$sha"

  if [ "$push" = 1 ]; then
    git merge-base --is-ancestor "$sha" "$MAIN_REF" \
      || { echo "build-image: REFUSED. $sha is not on main, and only commits on main are published." >&2; exit 1; }
    if [ "$surface" = gateway ]; then
      local missing
      missing=$(missing_public_values)
      [ -z "$missing" ] \
        || { echo "build-image: REFUSED. These public build values are not set as repository variables: $missing" >&2; exit 1; }
    fi
    # "No such image" has to be an answer the registry gave. A lookup that
    # failed for any other reason is not permission to publish over a tag.
    local existing
    if existing=$(docker buildx imagetools inspect "$ref" --format '{{json .Manifest.Digest}}' 2>&1); then
      note "$surface: an image for $sha is already published and was left as it is: $image@${existing//\"/}"
      return
    elif ! says_absent "$ref" "$existing"; then
      echo "build-image: REFUSED. Could not tell whether an image for $sha already exists:" >&2
      echo "$existing" | tail -3 >&2
      exit 1
    fi
  fi

  # The commit's tree, and only that, in a directory that held nothing.
  local src
  src=$(mktemp -d)
  EXPORT_DIR="$src" # global: the trap runs after this function's locals are gone
  trap 'rm -rf "$EXPORT_DIR"' EXIT
  export_commit . "$sha" "$src"
  verify_export . "$sha" "$src"

  local started=$SECONDS
  # The public values are named, not given: docker takes each from the
  # environment, and an unset one stays the Dockerfile's empty default.
  local value_args=() name
  if [ "$surface" = gateway ]; then
    for name in $GATEWAY_PUBLIC_VALUES; do
      if [ -n "${!name:-}" ]; then value_args+=(--build-arg "$name"); fi
    done
  fi
  docker build \
    --platform linux/amd64 \
    --file "$src/$dockerfile" \
    --build-arg "$sha_arg=$sha" \
    ${value_args[@]+"${value_args[@]}"} \
    --label "org.opencontainers.image.revision=$sha" \
    --label "org.opencontainers.image.source=$SOURCE_URL" \
    --label "org.opencontainers.image.title=$surface" \
    --tag "$ref" \
    "$src/$context"
  local took=$((SECONDS - started))

  local label size
  label=$(docker image inspect "$ref" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')
  [ "$label" = "$sha" ] \
    || { echo "build-image: FAILED. The image's revision label is '$label', not $sha." >&2; exit 1; }
  size=$(docker image inspect "$ref" --format '{{ .Size }}')

  if [ "$surface" = canary ]; then
    # Started with what production will give it: a read-only filesystem, no
    # network, and nothing it could escalate with.
    local name="canary-check-$$" answer=""
    docker run --detach --rm --name "$name" --read-only --network none \
      --cap-drop ALL --security-opt no-new-privileges "$ref" >/dev/null
    local try
    for try in 1 2 3 4 5 6 7 8 9 10; do
      answer=$(docker exec "$name" node -e \
        "fetch('http://127.0.0.1:8080/health').then(r=>r.json()).then(j=>console.log(j.sha)).catch(()=>process.exit(1))" 2>/dev/null) && break
      sleep 1
    done
    docker stop --time 5 "$name" >/dev/null 2>&1 || true
    [ "$answer" = "$sha" ] \
      || { echo "build-image: FAILED. The canary did not report the commit it was built from." >&2; exit 1; }
    echo "canary: started read-only and reported its own commit."
  fi

  if [ "$push" = 1 ]; then
    docker push "$ref"
    local digest
    digest=$(docker buildx imagetools inspect "$ref" --format '{{json .Manifest.Digest}}')
    digest="${digest//\"/}"
    [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] \
      || { echo "build-image: FAILED. The registry did not return a digest for the pushed image." >&2; exit 1; }
    note "$surface: published $image@$digest for $sha. Built in ${took}s, $((size / 1000000)) MB. Revision label verified."
    if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "digest=$digest" >>"$GITHUB_OUTPUT"; fi
  else
    local unset_note=""
    if [ "$surface" = gateway ] && [ -n "$(missing_public_values)" ]; then
      unset_note=" Built WITHOUT some public build values, so this build is a check and not a deployable image."
    fi
    note "$surface: built for $sha and NOT published. Built in ${took}s, $((size / 1000000)) MB. Revision label verified.$unset_note"
  fi
}

main "$@"
