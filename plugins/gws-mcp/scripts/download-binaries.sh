#!/bin/bash
# Fetch the pinned gws CLI into bin/.
#
#   download-binaries.sh           every target (what the desktop bundle packs)
#   download-binaries.sh --host    only this machine's target, and nothing at
#                                  all if it is already there at this version.
#                                  The test task runs this: the oracle test
#                                  needs the CLI and never skips without it.
#
# Each archive is checked against the sha256 below before it is unpacked. The
# values are the ones the release publishes for this version; a new VERSION
# needs new values, and an archive that does not match is deleted and the
# script stops.
set -euo pipefail

VERSION="0.17.0"
BASE_URL="https://github.com/googleworkspace/cli/releases/download/v${VERSION}"
BIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"

sha256_for() {
  case "$1" in
    gws-aarch64-apple-darwin.tar.gz)     echo e05e9c4f4ee08590757a606394459cce0c6a04dd6f33e5215877beaa460abe20 ;;
    gws-x86_64-apple-darwin.tar.gz)      echo 8493c88926518934f860d864ee35006a3357a59d6d14fd025708b37da35b1515 ;;
    gws-x86_64-unknown-linux-gnu.tar.gz) echo 83aa90d2dd2341756cdf9ab0738844fc467881cd965e8257cb5b4c4ebdbacae7 ;;
    gws-x86_64-pc-windows-msvc.zip)      echo eab43372c3890a5e41c926239e3e0789523ccea692ef23265138b1eb11c2478b ;;
    *) return 1 ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# The same choice the oracle test makes when it looks for the binary.
host_target() {
  if [ "$(uname -s)" = "Darwin" ]; then
    if [ "$(uname -m)" = "arm64" ]; then echo gws-aarch64-apple-darwin; else echo gws-x86_64-apple-darwin; fi
  else
    echo gws-x86_64-unknown-linux-gnu
  fi
}

TARGETS=(
  "gws-aarch64-apple-darwin"
  "gws-x86_64-apple-darwin"
  "gws-x86_64-unknown-linux-gnu"
  "gws-x86_64-pc-windows-msvc"
)

if [ "${1:-}" = "--host" ]; then
  TARGET="$(host_target)"
  if [ -x "$BIN_DIR/$TARGET/gws" ] && [ "$(cat "$BIN_DIR/$TARGET/.version" 2>/dev/null)" = "$VERSION" ]; then
    exit 0
  fi
  TARGETS=("$TARGET")
fi

mkdir -p "$BIN_DIR"

for TARGET in "${TARGETS[@]}"; do
  if [[ "$TARGET" == *"windows"* ]]; then
    ARCHIVE="${TARGET}.zip"
  else
    ARCHIVE="${TARGET}.tar.gz"
  fi

  echo "Downloading ${ARCHIVE}..."
  curl -fsSL -o "$BIN_DIR/${ARCHIVE}" "${BASE_URL}/${ARCHIVE}"

  WANT="$(sha256_for "$ARCHIVE")"
  GOT="$(sha256_of "$BIN_DIR/${ARCHIVE}")"
  if [ "$GOT" != "$WANT" ]; then
    rm -f "$BIN_DIR/${ARCHIVE}"
    echo "Checksum mismatch for ${ARCHIVE}: it is not the pinned release file. Nothing was unpacked." >&2
    exit 1
  fi

  echo "Extracting ${ARCHIVE}..."
  if [[ "$ARCHIVE" == *.zip ]]; then
    unzip -o "$BIN_DIR/${ARCHIVE}" -d "$BIN_DIR"
  else
    tar -xzf "$BIN_DIR/${ARCHIVE}" -C "$BIN_DIR"
    echo "$VERSION" > "$BIN_DIR/${TARGET}/.version"
  fi

  rm "$BIN_DIR/${ARCHIVE}"
done

# Set executable permissions on macOS/Linux binaries
chmod +x "$BIN_DIR/gws-aarch64-apple-darwin/gws" "$BIN_DIR/gws-x86_64-apple-darwin/gws" "$BIN_DIR/gws-x86_64-unknown-linux-gnu/gws" 2>/dev/null || true

echo "Done. Binaries in ${BIN_DIR}:"
ls -la "$BIN_DIR"
