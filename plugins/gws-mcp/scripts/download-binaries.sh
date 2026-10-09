#!/bin/bash
set -euo pipefail

VERSION="0.17.0"
BASE_URL="https://github.com/googleworkspace/cli/releases/download/v${VERSION}"
BIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"

mkdir -p "$BIN_DIR"

TARGETS=(
  "gws-aarch64-apple-darwin"
  "gws-x86_64-apple-darwin"
  "gws-x86_64-unknown-linux-gnu"
  "gws-x86_64-pc-windows-msvc"
)

for TARGET in "${TARGETS[@]}"; do
  if [[ "$TARGET" == *"windows"* ]]; then
    ARCHIVE="${TARGET}.zip"
  else
    ARCHIVE="${TARGET}.tar.gz"
  fi

  echo "Downloading ${ARCHIVE}..."
  curl -L -o "$BIN_DIR/${ARCHIVE}" "${BASE_URL}/${ARCHIVE}"

  echo "Extracting ${ARCHIVE}..."
  if [[ "$ARCHIVE" == *.zip ]]; then
    unzip -o "$BIN_DIR/${ARCHIVE}" -d "$BIN_DIR"
  else
    tar -xzf "$BIN_DIR/${ARCHIVE}" -C "$BIN_DIR"
  fi

  rm "$BIN_DIR/${ARCHIVE}"
done

# Set executable permissions on macOS/Linux binaries
chmod +x "$BIN_DIR/gws-aarch64-apple-darwin/gws" "$BIN_DIR/gws-x86_64-apple-darwin/gws" "$BIN_DIR/gws-x86_64-unknown-linux-gnu/gws" 2>/dev/null || true

echo "Done. Binaries in ${BIN_DIR}:"
ls -la "$BIN_DIR"
