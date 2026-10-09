#!/usr/bin/env bash
# The digest of the image that main's build published for one surface and
# commit (SCRUM-394). The deploy workflow runs this; a person can too.
#
#   scripts/published-digest.sh <surface> <sha>   # prints sha256:...
#   scripts/published-digest.sh --self-test
#
# Needs: a checkout with main fetched, `gh` signed in (GH_TOKEN in a
# workflow), and docker for the last check.
#
# Why this exists: a tag in the registry can be written by anyone who can push
# a branch here, so a tag is not evidence of where an image came from. The
# build workflow keeps the digest it pushed as an artifact of its run. This
# script accepts that artifact only if the run that made it
#   - is a run of .github/workflows/build.yml in this repository,
#   - was started by a push or a dispatch, never by a pull request, and
#   - ran at a commit that is on main, so the workflow and the build script it
#     used are ones a merged pull request put there.
# Then it asks the registry what the tag holds now. If that is not the digest
# the run recorded, something has moved the tag, and it stops.
#
# What it cannot say: that the run was honest. It says which run, and that the
# run's rules were main's.
#
# Limit: an artifact lasts 90 days. An image older than that has no record
# left and is not deployable through the pipeline; the surface needs a newer
# build. The host keeps its own images for rollback and does not ask here.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-datatorag/mcp-gateway}"
IMAGE_PREFIX="ghcr.io/datatorag/mcp-gateway"
BUILD_WORKFLOW=".github/workflows/build.yml"
MAIN_REF="refs/remotes/origin/main" # in full: a tag named origin/main must not decide

valid_surface() { case "$1" in canary | gateway) ;; *) return 1 ;; esac; }
valid_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
valid_digest() { [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]]; }

# ---- everything that asks the world; the self-test replaces these -----------

# "<artifact id> <run id> <run head sha>" per artifact of that name still held.
artifacts_named() {
  gh api "repos/$REPO/actions/artifacts?name=$1&per_page=100" \
    --jq '.artifacts[] | select(.expired == false) | "\(.id) \(.workflow_run.id) \(.workflow_run.head_sha)"'
}
# "<workflow path> <event> <repository the run's commit came from>"
run_facts() {
  gh api "repos/$REPO/actions/runs/$1" --jq '"\(.path) \(.event) \(.head_repository.full_name)"'
}
on_main() { git merge-base --is-ancestor "$1" "$MAIN_REF" 2>/dev/null; }
# The one line the build wrote into its artifact.
artifact_line() {
  local dir rc=0
  dir=$(mktemp -d)
  { gh api "repos/$REPO/actions/artifacts/$1/zip" >"$dir/a.zip" && unzip -p "$dir/a.zip" image.txt; } || rc=$?
  rm -rf "$dir"
  return "$rc"
}
tag_digest() {
  local out
  out=$(docker buildx imagetools inspect "$1" --format '{{json .Manifest.Digest}}') || return 1
  echo "${out//\"/}"
}

# ---- the decision -----------------------------------------------------------

stop() { echo "published-digest: $1" >&2; exit 1; }

find_digest() { # <surface> <sha>
  local surface="$1" sha="$2" name found="" id run head path event from line digest listing facts
  name="image-$surface-$sha"
  listing=$(artifacts_named "$name") || stop "Could not list the build records."
  # One page is read. More records of one name than a page holds is not
  # something a build on main produces.
  [ "$(grep -c . <<<"$listing")" -lt 100 ] \
    || stop "There are too many records named $name to judge. Not deployable until a person has looked."
  while read -r id run head; do
    [ -n "$id" ] || continue
    [[ "$id" =~ ^[0-9]+$ ]] && [[ "$run" =~ ^[0-9]+$ ]] && valid_sha "$head" || continue
    on_main "$head" || continue
    # A lookup that failed is not "some other workflow": a record that could
    # not be judged might be the one that disagrees.
    facts=$(run_facts "$run") || stop "Could not read run $run."
    read -r path event from <<<"$facts"
    [ "$path" = "$BUILD_WORKFLOW" ] || continue
    [ "$from" = "$REPO" ] || continue
    case "$event" in push | workflow_dispatch) ;; *) continue ;; esac
    line=$(artifact_line "$id") || stop "Could not read the record of run $run."
    digest="${line#"$surface $sha "}"
    [ "$line" = "$surface $sha $digest" ] && valid_digest "$digest" \
      || stop "The record of run $run is not for $surface at $sha."
    [ -z "$found" ] || [ "$found" = "$digest" ] \
      || stop "Two runs on main recorded different images for $surface at $sha. Not deployable until a person has looked."
    found="$digest"
  done <<<"$listing"
  [ -n "$found" ] || stop "No build on main has a record of publishing $surface for $sha. Either it was never built there, or the record is older than 90 days."
  local now
  now=$(tag_digest "$IMAGE_PREFIX/$surface:$sha") || stop "Could not ask the registry what the tag for $sha holds."
  [ "$now" = "$found" ] \
    || stop "The registry's tag for $sha no longer holds the image the build published. Not deployable until a person has looked."
  echo "$found"
}

self_test() {
  local failed=0 T sha other dig out
  T=$(mktemp -d)
  sha=$(printf '%040d' 1); other=$(printf '%040d' 2); dig=$(printf 'sha256:%064d' 1)
  # World: files the stand-ins read. One artifact per line in $T/artifacts.
  artifacts_named() { [ ! -e "$T/list-fails" ] || return 1; grep " $1\$" "$T/artifacts" | cut -d' ' -f1-3 || true; }
  run_facts() { grep "^$1 " "$T/runs" | cut -d' ' -f2-; } # fails when the run is unknown
  on_main() { grep -qx "$1" "$T/main"; }
  artifact_line() { grep "^$1 " "$T/lines" | cut -d' ' -f2-; }
  tag_digest() { cat "$T/tag"; }
  world() { # reset to one honest record
    echo "$sha" >"$T/main"
    echo "10 100 $sha image-canary-$sha" >"$T/artifacts"
    echo "100 $BUILD_WORKFLOW push $REPO" >"$T/runs"
    echo "10 canary $sha $dig" >"$T/lines"
    echo "$dig" >"$T/tag"
    rm -f "$T/list-fails"
  }
  accept() { # <description>
    if ! out=$(find_digest canary "$sha" 2>&1) || [ "$out" != "$dig" ]; then
      echo "published-digest self-test FAILED: $1: $out"; failed=1
    fi
  }
  reject() { # <description> <text the refusal must hold>
    if out=$(find_digest canary "$sha" 2>&1) || ! grep -Fq -- "$2" <<<"$out"; then
      echo "published-digest self-test FAILED: $1: $out"; failed=1
    fi
  }
  world; accept "a record from a push to main is accepted"
  world; echo "100 $BUILD_WORKFLOW workflow_dispatch $REPO" >"$T/runs"
  accept "a record from a dispatch on main is accepted"
  world; : >"$T/artifacts"
  reject "no record means not deployable" "No build on main has a record"
  world; echo "10 100 $other image-canary-$sha" >"$T/artifacts"
  reject "a record from a run at a commit that is not on main is ignored" "No build on main has a record"
  world; echo "100 $BUILD_WORKFLOW pull_request $REPO" >"$T/runs"
  reject "a record from a pull request run is ignored" "No build on main has a record"
  world; echo "100 .github/workflows/other.yml push $REPO" >"$T/runs"
  reject "a record from another workflow is ignored" "No build on main has a record"
  world; echo "100 $BUILD_WORKFLOW push someone/fork" >"$T/runs"
  reject "a record from a fork's commit is ignored" "No build on main has a record"
  world; echo "10 canary $other $dig" >"$T/lines"
  reject "a record for another commit is refused" "is not for canary"
  world; echo "10 gateway $sha $dig" >"$T/lines"
  reject "a record for another surface is refused" "is not for canary"
  world; echo "10 canary $sha latest" >"$T/lines"
  reject "a record without a digest is refused" "is not for canary"
  world; echo "10 canary $sha $dig extra" >"$T/lines"
  reject "a record with more on the line is refused" "is not for canary"
  world; printf 'sha256:%064d\n' 9 >"$T/tag"
  reject "a tag that moved since the build is refused" "no longer holds"
  world
  echo "11 101 $sha image-canary-$sha" >>"$T/artifacts"
  echo "101 $BUILD_WORKFLOW push $REPO" >>"$T/runs"
  printf '11 canary %s sha256:%064d\n' "$sha" 9 >>"$T/lines"
  reject "two records that disagree are refused" "recorded different images"
  world
  echo "11 101 $other image-canary-$sha" >>"$T/artifacts"
  printf '11 canary %s sha256:%064d\n' "$sha" 9 >>"$T/lines"
  accept "a forged record beside the honest one changes nothing"
  world; : >"$T/runs"
  reject "a run that cannot be read is not skipped" "Could not read run"
  world; touch "$T/list-fails"
  reject "a failed lookup is not read as an answer" "Could not list"
  rm -rf "$T"
  if [ "$failed" = 1 ]; then exit 2; fi
  echo "published-digest self-test ok: only a record from a build on main is accepted, and only while the tag still holds it."
}

main() {
  if [ "${1:-}" = "--self-test" ]; then
    self_test
    return
  fi
  [ "$#" -eq 2 ] || { echo "usage: scripts/published-digest.sh <surface> <sha>" >&2; exit 2; }
  valid_surface "$1" || { echo "published-digest: not a surface." >&2; exit 2; }
  valid_sha "$2" || { echo "published-digest: the commit must be a full 40-character sha." >&2; exit 2; }
  find_digest "$1" "$2"
}

main "$@"
