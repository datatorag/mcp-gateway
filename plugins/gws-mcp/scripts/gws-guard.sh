#!/usr/bin/env bash
#
# gws-guard.sh — refuse a `gws` write whose acting identity was never stated.
#
# WHY THIS EXISTS
#
# The gws CLI takes its identity from ambient environment
# (GOOGLE_WORKSPACE_CLI_TOKEN, then GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE, then
# the keyring under GOOGLE_WORKSPACE_CLI_CONFIG_DIR). Nothing about the acting
# account appears in the command you type, and `gws auth status` does not report
# it either — it prints the client config, the credential paths and the granted
# scopes, and no email address anywhere. So a write issued against the wrong
# account succeeds, lands in a different person's data, and exits 0. There is no
# failure signal to notice.
#
# `--account` is not a missing feature we can wait for: it was removed in gws
# 0.7.0 along with multi-account, domain-wide delegation and impersonation. No
# upgrade restores it. A wrapper is the fix that is available to us.
#
# WHAT IT DOES
#
#   read   pass straight through, no extra API call, no identity required
#   write  require a stated identity, resolve the identity the binary will
#          actually act as, refuse on mismatch, and echo it before proceeding
#
# Unknown methods count as writes. That direction is deliberate: a misclassified
# read costs one resolution call and a clear message, a misclassified write
# costs data in someone else's account.
#
# USAGE
#
#   scripts/gws-guard.sh --as you@example.com tasks tasklists insert --json '{"title":"Q3"}'
#   GWS_EXPECT_ACCOUNT=you@example.com scripts/gws-guard.sh tasks tasklists insert --json '...'
#   scripts/gws-guard.sh tasks tasklists list          # read: no identity needed
#
# ENVIRONMENT
#
#   GWS_EXPECT_ACCOUNT  the identity the caller asserts it is acting as
#   GWS_BIN             which gws binary to run. Defaults to this repo's
#                       vendored binary for the current platform, falling back
#                       to `gws` on PATH. The two are not the same version, and
#                       the guard prints which one it used for exactly that
#                       reason.
#
# EXIT CODES
#
#   9   refused by the guard (distinct from the CLI's own 0-5, so a caller can
#       tell "the guard stopped this" from "Google rejected this")
#   *   otherwise the gws exit code, passed through untouched

set -uo pipefail

GUARD_REFUSED=9

die() {
  printf 'gws-guard: REFUSED — %s\n' "$1" >&2
  exit "$GUARD_REFUSED"
}

note() {
  printf 'gws-guard: %s\n' "$1" >&2
}

# --- which binary -----------------------------------------------------------

resolve_bin() {
  if [[ -n "${GWS_BIN:-}" ]]; then
    printf '%s' "$GWS_BIN"
    return 0
  fi

  local repo_bin candidate
  repo_bin="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/bin"
  case "$(uname -s)/$(uname -m)" in
    Darwin/arm64) candidate="$repo_bin/gws-aarch64-apple-darwin/gws" ;;
    Darwin/x86_64) candidate="$repo_bin/gws-x86_64-apple-darwin/gws" ;;
    Linux/x86_64) candidate="$repo_bin/gws-x86_64-unknown-linux-gnu/gws" ;;
    *) candidate="" ;;
  esac

  if [[ -n "$candidate" && -x "$candidate" ]]; then
    printf '%s' "$candidate"
  else
    command -v gws || true
  fi
}

# --- read or write ----------------------------------------------------------

# Methods that cannot change anything. Everything not named here is treated as
# a write, including methods this list has never heard of.
READ_METHODS=" list get search query getProfile export "

# Prints "read" or "write" for an argv.
classify() {
  local positionals=()
  local arg
  for arg in "$@"; do
    [[ "$arg" == -* ]] && break
    positionals+=("$arg")
  done

  # `gws --help`, `gws --version`
  if [[ ${#positionals[@]} -eq 0 ]]; then
    printf 'read'
    return 0
  fi

  case "${positionals[0]}" in
    # Prints a discovery schema. Touches nothing.
    schema)
      printf 'read'
      return 0
      ;;
    # auth manages the identity rather than acting under one, so demanding a
    # stated identity here would be circular: `auth login` is how you get one.
    auth)
      printf 'read'
      return 0
      ;;
  esac

  # Helper commands (`gws sheets +export ...`) put the verb in a `+command`
  # token and their positional tail is not a method name, so the rule below
  # cannot classify them. Unrecognised means write.
  for arg in "${positionals[@]}"; do
    if [[ "$arg" == +* ]]; then
      printf 'write'
      return 0
    fi
  done

  local method="${positionals[${#positionals[@]} - 1]}"
  if [[ "$READ_METHODS" == *" $method "* ]]; then
    printf 'read'
  else
    printf 'write'
  fi
}

# --- who are we actually acting as ------------------------------------------

# Resolves the identity through the same binary and the same environment the
# write will use, so the answer is about this invocation and not about a
# config file read separately.
resolve_identity() {
  local out email

  # Narrowed to the one field on purpose: a wider response also carries the
  # account's display name, which is caller-controlled text sitting next to the
  # value being extracted. Asking for only the address leaves nothing else in
  # the JSON for the extraction below to pick up by mistake.
  out="$("$BIN" drive about get --params '{"fields":"user/emailAddress"}' 2>/dev/null)"
  email="$(printf '%s' "$out" \
    | grep -o '"emailAddress"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"

  # Falls back to People for a caller without the Drive scope.
  if [[ -z "$email" ]]; then
    out="$("$BIN" people people get \
      --params '{"resourceName":"people/me","personFields":"emailAddresses"}' 2>/dev/null)"
    email="$(printf '%s' "$out" \
      | grep -oE '"value"[[:space:]]*:[[:space:]]*"[^"]+@[^"]+"' \
      | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
  fi

  [[ -n "$email" ]] || return 1
  printf '%s' "$email"
}

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# --- main -------------------------------------------------------------------

EXPECTED="${GWS_EXPECT_ACCOUNT:-}"
if [[ "${1:-}" == "--as" ]]; then
  [[ $# -ge 2 ]] || die "--as needs an email address."
  EXPECTED="$2"
  shift 2
fi

BIN="$(resolve_bin)"
[[ -n "$BIN" && -x "$BIN" ]] || die "no gws binary found. Set GWS_BIN to one."

if [[ "$(classify "$@")" == "read" ]]; then
  exec "$BIN" "$@"
fi

if [[ -z "$EXPECTED" ]]; then
  die "this is a write and no identity was stated.
  The gws CLI takes its account from ambient environment, so a write to the
  wrong account succeeds and exits 0. State who you mean to be:
      $(basename "${BASH_SOURCE[0]}") --as you@example.com $*
  or set GWS_EXPECT_ACCOUNT."
fi

ACTUAL="$(resolve_identity)"
if [[ -z "$ACTUAL" ]]; then
  die "could not determine the acting identity, so the write is not allowed.
  The identity call needs the Drive or People scope. Without it there is no
  way to tell whose data this would write to."
fi

if [[ "$(lower "$ACTUAL")" != "$(lower "$EXPECTED")" ]]; then
  die "identity mismatch — nothing was written.
      stated:  $EXPECTED
      acting:  $ACTUAL
      binary:  $BIN
  The write was blocked because it would have landed in the acting account."
fi

note "binary $BIN ($("$BIN" --version 2>/dev/null | head -1))"
note "acting as $ACTUAL — proceeding with: $*"
exec "$BIN" "$@"
