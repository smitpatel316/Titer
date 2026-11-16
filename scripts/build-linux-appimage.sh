#!/usr/bin/env bash
# Build the Titer Linux AppImage on Hatch. Run from the repo root:
#   ./scripts/build-linux-appimage.sh [OUT_DIR]
#
# Why this script exists (learned 2026-11-15): there was no repo command
# that builds the AppImage end to end. The v1.3.0 release lane ran
# `./scripts/build-webr-repo.sh` + `npx tauri build --bundles appimage`
# by hand and its attempt 2 failed with
#   resource path `binaries/titer-stdio-bridge-x86_64-unknown-linux-gnu`
#   doesn't exist
# because nothing had staged the stdio-bridge sidecar first — the same
# stale/missing-bridge gap as the Mac DMG path (build-mac-dmg.sh never
# rebuilt it either, and the 7fbeab7 batch build shipped a stale bridge
# that gets HTTP 400 from the in-app MCP server). This script stages the
# bridge from current source before every tauri build, exactly like the
# Mac script does, and fails hard if staging is missing.
#
# OUT_DIR (optional): if given, the built AppImage is copied there with a
# .sha256 alongside. Otherwise the AppImage stays under
# src-tauri/target/release/bundle/appimage/ and this script prints its
# path + sha256.
#
# Notes:
# - Tauri's own bundling usually succeeds now (v1.3.0 attempt 4); the
#   manual linuxdeploy fallback below is for when it doesn't. It needs
#   `linuxdeploy` on PATH (the v1.3.0 lane used the one from the Tauri
#   cache / /usr/local/bin).
# - Caller sets TMPDIR to a lane-specific dir under ~/workspace (never
#   /tmp — fills, gets wiped) and CARGO_BUILD_JOBS=1 if the box is
#   memory-tight; this script defaults JOBS=1 unless already set.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

OUT_DIR="${1:-}"
VERSION="$(node -p "require('./package.json').version")"
export PATH="$HOME/.cargo/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"

# The vendored R package repo (plan 00) ships inside the app bundle; build
# it first so the AppImage is offline-capable. Skips downloads on disk.
./scripts/build-webr-repo.sh

# stdio-bridge sidecar (2026-11-15): Tauri's externalBin bundles whatever
# binary sits in src-tauri/binaries/ (gitignored, never rebuilt by
# `tauri build`). A stale bridge cannot talk to the in-app MCP server
# (missing MCP-Protocol-Version/Accept headers -> HTTP 400). Rebuild
# from current source before every tauri build, and fail hard if the
# staged binary for the host triple is missing.
./scripts/build-stdio-bridge.sh
HOST_TRIPLE="$(rustc --print host-tuple)"
[ -f "src-tauri/binaries/titer-stdio-bridge-$HOST_TRIPLE" ] || { echo "ERROR: stdio-bridge for $HOST_TRIPLE not staged" >&2; exit 1; }
ls -lh "src-tauri/binaries/titer-stdio-bridge-$HOST_TRIPLE"

echo "=== tauri build --bundles appimage ==="
npx tauri build --bundles appimage || true

BUNDLE_DIR="src-tauri/target/release/bundle/appimage"
BUILT="$(ls -t "$BUNDLE_DIR"/*.AppImage 2>/dev/null | head -1 || true)"
if [ -z "$BUILT" ]; then
  echo "=== tauri bundling produced no AppImage — manual linuxdeploy fallback ==="
  APPDIR="$(ls -d "$BUNDLE_DIR"/*.AppDir 2>/dev/null | head -1 || true)"
  [ -n "$APPDIR" ] || { echo "ERROR: no AppDir under $BUNDLE_DIR" >&2; ls -la "$BUNDLE_DIR" >&2 || true; exit 1; }
  command -v linuxdeploy >/dev/null || { echo "ERROR: linuxdeploy not on PATH (needed for the manual fallback)" >&2; exit 1; }
  ( cd "$BUNDLE_DIR" && linuxdeploy --appdir "$APPDIR" --plugin gtk --plugin gstreamer --output appimage )
  BUILT="$(ls -t "$BUNDLE_DIR"/*.AppImage 2>/dev/null | head -1 || true)"
  [ -n "$BUILT" ] || { echo "ERROR: manual linuxdeploy produced no AppImage" >&2; exit 1; }
fi

echo "=== AppImage: $BUILT ==="
ls -lh "$BUILT"
SHA="$(sha256sum "$BUILT" | cut -d' ' -f1)"
echo "sha256: $SHA"
file "$BUILT" || true

if [ -n "$OUT_DIR" ]; then
  mkdir -p "$OUT_DIR"
  ARTIFACT="$OUT_DIR/Titer-${VERSION}-linux.AppImage"
  cp "$BUILT" "$ARTIFACT"
  chmod +x "$ARTIFACT"
  ( cd "$OUT_DIR" && sha256sum "Titer-${VERSION}-linux.AppImage" > "Titer-${VERSION}-linux.AppImage.sha256" )
  ( cd "$OUT_DIR" && sha256sum -c "Titer-${VERSION}-linux.AppImage.sha256" )
  echo "staged: $ARTIFACT"
fi
