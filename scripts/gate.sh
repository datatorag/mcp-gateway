#!/usr/bin/env bash
# The pre-merge gate: what a pull request must pass, and what a person runs
# before a push. One script, so the two cannot drift apart.
#
#   scripts/gate.sh [<base>]      # default base: refs/remotes/origin/main
#   scripts/gate.sh --self-test   # prove the path table still classifies
#   scripts/gate.sh --surfaces <base>   # only print the surfaces the range
#                                       # selects; the image build reads this
#
# What it does:
#   1. Ancestry: <base> must be an ancestor of HEAD. A branch that has fallen
#      behind is tested against a tree that is not the one it would merge into.
#   2. Maps every changed path to a surface (the table in classify_path).
#   3. Runs typecheck and tests for the surfaces that changed, and nothing for
#      a change that touches no surface.
#
# What it does NOT do, so a pass is not read as more than it is:
#   - the security review and the leak scan. Those run on the whole range,
#     never filtered by path, and they are separate steps.
#   - the production build.
#   - the pattern check. It is advisory by decision and has its own hook.
#   - any suite gated on a live registry or a running plugin. Those report as
#     skipped, and skipped is not passed.
#
# A path the table does not know selects EVERYTHING. A new top-level directory
# must not be able to slip through as "not a surface".
set -euo pipefail

# Names no real host and carries no credential: .invalid never resolves. It
# is deliberately not shaped like a database address, so the leak scan's rule
# for connection strings has nothing to object to. See run_gateway.
PLACEHOLDER_DATABASE_URL="unset://database.invalid/unset"

# One line per changed path on stdin; one surface per line on stdout.
#   gateway  typecheck and tests of apps/gateway
#   scripts  the self-tests of the scripts in scripts/
#   canary   the test of the do-nothing container in docker/canary
#   gws-mcp, atlassian-mcp
#            a plugin's build and tests. A plugin path selects its own row
#            AND the gateway: the plugins ship inside the gateway's image, so
#            a plugin change is a gateway change wherever an image is decided
#   none     nothing this gate has tests for: documentation, agent guidance,
#            and tools/, which has no suite of its own
#   all      unknown, or a file every surface depends on
classify_path() {
  case "$1" in
    docker/canary/*) echo canary ;; # before docker/*, which is the gateway's
    plugins/gws-mcp/*) echo gws-mcp ;;
    plugins/atlassian-mcp/*) echo atlassian-mcp ;;
    apps/gateway/*|packages/*|docker/*) echo gateway ;;
    scripts/*) echo scripts ;;
    .github/*) echo all ;;
    package.json|pnpm-lock.yaml|pnpm-workspace.yaml|turbo.json|tsconfig.base.json|.npmrc) echo all ;;
    .env.example) echo gateway ;; # a gateway test reads it
    docs/*|.claude/*|tools/*|README.md|CLAUDE.md|LICENSE|.gitignore) echo none ;;
    *) echo all ;;
  esac
}

surfaces_for() {
  local path surface want_gateway=0 want_scripts=0 want_canary=0 want_gws=0 want_atlassian=0
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    surface=$(classify_path "$path")
    case "$surface" in
      gateway) want_gateway=1 ;;
      scripts) want_scripts=1 ;;
      canary) want_canary=1 ;;
      gws-mcp) want_gateway=1; want_gws=1 ;;
      atlassian-mcp) want_gateway=1; want_atlassian=1 ;;
      all) want_gateway=1; want_scripts=1; want_canary=1; want_gws=1; want_atlassian=1 ;;
      none) ;;
    esac
  done
  [ "$want_gateway" = 1 ] && echo gateway
  [ "$want_scripts" = 1 ] && echo scripts
  [ "$want_canary" = 1 ] && echo canary
  [ "$want_gws" = 1 ] && echo gws-mcp
  [ "$want_atlassian" = 1 ] && echo atlassian-mcp
  return 0
}

self_test() {
  local failed=0
  expect() { # <description> <expected surfaces, space separated> <paths...>
    local what="$1" want="$2" got
    shift 2
    got=$(printf '%s\n' "$@" | surfaces_for | tr '\n' ' ' | sed 's/ $//')
    if [ "$got" != "$want" ]; then
      echo "gate self-test FAILED: $what: wanted '$want', got '$got'"
      failed=1
    fi
  }
  expect "a gateway source file" "gateway" "apps/gateway/src/gateway/health.ts"
  expect "gateway content is the gateway" "gateway" "apps/gateway/content/docs/gmail.md"
  expect "a shared package" "gateway" "packages/db/src/index.ts"
  expect "the compose file" "gateway" "docker/docker-compose.prod.yml"
  expect "a script" "scripts" "scripts/gate.sh"
  expect "the canary is its own surface, not the gateway's" "canary" "docker/canary/server.mjs"
  expect "the canary beside the compose file selects both" "gateway canary" "docker/canary/Dockerfile" "docker/docker-compose.prod.yml"
  expect "documentation only" "" "docs/architecture/x.md" ".claude/skills/deploy/SKILL.md" "README.md"
  expect "the example env file is read by a gateway test" "gateway" ".env.example"
  expect "a file moved out of the gateway still names where it was" "gateway" "apps/gateway/src/guard.test.ts" "docs/guard.test.ts"
  expect "documentation beside code still selects the code" "gateway" "docs/x.md" "apps/gateway/server.ts"
  expect "the lockfile selects everything" "gateway scripts canary gws-mcp atlassian-mcp" "pnpm-lock.yaml"
  expect "a workflow selects everything" "gateway scripts canary gws-mcp atlassian-mcp" ".github/workflows/ci.yml"
  # The known-bad cases: a path nobody listed must never come out as nothing.
  expect "an unknown top-level directory selects everything" "gateway scripts canary gws-mcp atlassian-mcp" "services/new-thing/src/index.ts"
  expect "a plugin nobody listed selects everything" "gateway scripts canary gws-mcp atlassian-mcp" "plugins/new-thing/src/index.ts"
  expect "a plugin selects its own tests and the gateway" "gateway gws-mcp" "plugins/gws-mcp/src/tools/gmail.ts"
  expect "the other plugin does not run the first one's tests" "gateway atlassian-mcp" "plugins/atlassian-mcp/src/index.ts"
  expect "a plugin's documentation is still the plugin" "gateway gws-mcp" "plugins/gws-mcp/README.md"
  expect "an unknown root file selects everything" "gateway scripts canary gws-mcp atlassian-mcp" "Makefile"
  expect "a path that only looks like docs selects everything" "gateway scripts canary gws-mcp atlassian-mcp" "docs-private/x.md"
  if [ "$failed" = 1 ]; then
    exit 2
  fi
  echo "gate self-test ok: the path table classifies every case, unknown paths included."
}

run_gateway() {
  echo "##### gateway: build the packages it imports"
  pnpm exec turbo run build --filter='@datatorag-mcp/gateway^...'
  echo "##### gateway: typecheck"
  (cd apps/gateway && pnpm exec tsc --noEmit)
  echo "##### gateway: tests"
  # The config schema requires DATABASE_URL and exits the process without it,
  # which takes down suites that never open a connection. Where none is set
  # (CI, a fresh checkout) give it a placeholder that is a valid URL and names
  # a host that does not exist. The suites that need a real
  # database gate on their own, explicit variables and still report skipped.
  (cd apps/gateway && DATABASE_URL="${DATABASE_URL:-$PLACEHOLDER_DATABASE_URL}" pnpm exec vitest run)
}

# A plugin's own build and tests. gws-mcp's test task first fetches the one
# pinned CLI binary its oracle test compares against, checked by checksum.
run_plugin() {
  echo "##### $1: build"
  pnpm --filter "@datatorag-mcp/$1" run build
  echo "##### $1: tests"
  pnpm --filter "@datatorag-mcp/$1" run test
}

run_scripts() {
  echo "##### scripts: self-tests"
  bash scripts/gate.sh --self-test
  bash scripts/build-image.sh --self-test
  bash scripts/host-deploy.sh --self-test
  bash scripts/published-digest.sh --self-test
  python3 -m unittest scripts/test_leak_scan.py
  node scripts/registry-diff.mjs --self-test
  node --test scripts/registry-diff.test.mjs
  local t
  for t in scripts/hooks/test_*.py; do
    python3 -m unittest "$t"
  done
}

run_canary() {
  echo "##### canary: test"
  node --test docker/canary/server.test.mjs
}

main() {
  if [ "${1:-}" = "--self-test" ]; then
    self_test
    return
  fi
  if [ "${1:-}" = "--surfaces" ]; then
    [ -n "${2:-}" ] || { echo "gate: --surfaces needs a base commit." >&2; exit 2; }
    cd "$(git rev-parse --show-toplevel)"
    git rev-parse --verify --quiet "$2^{commit}" >/dev/null \
      || { echo "gate: base '$2' is not a commit here. Fetch it first." >&2; exit 2; }
    git diff --name-only --no-renames "$2...HEAD" | surfaces_for
    return
  fi
  # In full: a tag or a branch named origin/main would be found first under
  # the short name.
  local base="${1:-refs/remotes/origin/main}"
  cd "$(git rev-parse --show-toplevel)"

  echo "##### ancestry: $base must be an ancestor of HEAD"
  git rev-parse --verify --quiet "$base^{commit}" >/dev/null \
    || { echo "gate: base '$base' is not a commit here. Fetch it first."; exit 2; }
  git merge-base --is-ancestor "$base" HEAD \
    || { echo "gate: FAILED. $base is not an ancestor of HEAD: bring the branch up to date."; exit 1; }

  local changed surfaces
  # --no-renames: with rename detection a moved file shows only where it went,
  # so a test moved out of the gateway into docs/ would select nothing.
  changed=$(git diff --name-only --no-renames "$base...HEAD")
  if [ -z "$changed" ]; then
    echo "gate: no file differs from $base. Nothing to test, and nothing was tested."
    return
  fi
  surfaces=$(printf '%s\n' "$changed" | surfaces_for)
  echo "##### $(printf '%s\n' "$changed" | wc -l | tr -d ' ') changed path(s); surfaces: $(echo ${surfaces:-none})"

  if [ -z "$surfaces" ]; then
    echo "gate: ok. No path this gate has tests for changed, so no test ran."
    return
  fi
  local s
  for s in $surfaces; do
    case "$s" in
      gateway) run_gateway ;;
      scripts) run_scripts ;;
      canary) run_canary ;;
      gws-mcp|atlassian-mcp) run_plugin "$s" ;;
    esac
  done
  echo "gate: ok for: $(echo $surfaces). Not covered: the security review, the leak scan, the production build, and any suite that reported skipped."
}

main "$@"
