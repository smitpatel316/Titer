#!/bin/bash
# Negative controls for e2e/release (T-88..T-93).
#
# Every new check ships with a pre-fix FAIL / post-fix PASS pin: this
# script runs each check against deliberately broken input and asserts
# it FAILS (non-zero exit). A check that passes on broken input is a
# rubber stamp and must not ship. The green runs live in run.sh.
#
# Usage: bash e2e/release/selftest.sh [--cache-dir DIR]
# Exit 0 iff every broken input fails as expected.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CACHE="${1:-$REPO/e2e/out/release}"
[ "${1:-}" = "--cache-dir" ] && CACHE="$2"
mkdir -p "$CACHE"
PY="python3 $REPO/e2e/release"
FAIL=0
expect_fail() {
  local name="$1"; shift
  echo "--- pin: $name (must FAIL) ---"
  "$@" >/tmp/release-selftest.log 2>&1
  local rc=$?
  if [ "$rc" = 0 ]; then
    echo "SELFTEST FAIL: $name exited 0 on broken input"
    tail -5 /tmp/release-selftest.log
    FAIL=1
  else
    echo "SELFTEST PASS: $name failed as expected (exit $rc)"
    grep -m1 "^FAIL:" /tmp/release-selftest.log || true
  fi
}

# Fixtures: the cached 1.6.1 DMG (run.sh downloads it) + the 1.6.0 AppImage.
DMG="$CACHE/Titer-1.6.1-aarch64.dmg"
APPIMAGE="$CACHE/Titer-1.6.0-linux.AppImage"
if [ ! -f "$DMG" ]; then
  echo "selftest needs the cached release DMG — run e2e/release/run.sh first"
  exit 2
fi
MANIFEST_SHA="7ad41d28ac6754a206f798d36b5b3fc72b976d4e7228ea2ec2b0ef8bd1b81403"

# T-88: truncated DMG (the 1.6 MB / 512-byte-binary trap class) must fail.
head -c 1000000 "$DMG" > "$CACHE/truncated.dmg"
expect_fail "T-88 truncated DMG" $PY/check_dmg.py --dmg "$CACHE/truncated.dmg" --version 1.6.1
# T-88: wrong expected sha must fail.
expect_fail "T-88 wrong sha" $PY/check_dmg.py --dmg "$DMG" --version 1.6.1 --expected-sha 0000000000000000000000000000000000000000000000000000000000000000
# T-88: DMG older than the build-start stamp must fail (stale-DMG trap).
touch -d "2030-01-01" "$CACHE/future-stamp"
expect_fail "T-88 stale DMG (mtime before build-start stamp)" $PY/check_dmg.py --dmg "$DMG" --version 1.6.1 --build-start "$CACHE/future-stamp"

# T-89: a release that does not exist must fail.
expect_fail "T-89 nonexistent release" $PY/check_github_release.py --version 9.9.9 --cache-dir "$CACHE"
# T-89: a wrong expected sha must fail.
expect_fail "T-89 wrong sha" $PY/check_github_release.py --version 1.6.1 --cache-dir "$CACHE" --expected-sha Titer-1.6.1-aarch64.dmg=0000000000000000000000000000000000000000000000000000000000000000

# T-90: manifest checked against a version that is not live must fail.
expect_fail "T-90 wrong version" $PY/check_channel_manifest.py --version 9.9.9 --cache-dir "$CACHE"

# T-91: a tampered site source must fail byte-identity.
SITE_SRC="$HOME/workspace/your_files/titer-homepage/titer-homepage.html"
if [ -f "$SITE_SRC" ]; then
  cp "$SITE_SRC" "$CACHE/tampered-site.html"
  printf 'X' >> "$CACHE/tampered-site.html"
  expect_fail "T-91 tampered site source" $PY/check_website.py --version 1.6.1 --cache-dir "$CACHE" --site-source "$CACHE/tampered-site.html"
  expect_fail "T-91 wrong version (current sha absent)" $PY/check_website.py --version 9.9.9 --prev-version 1.6.1 --cache-dir "$CACHE" --site-source "$SITE_SRC"
else
  echo "SELFTEST SKIP: T-91 tamper pins need the site source at $SITE_SRC"
fi

# T-92: a one-byte-corrupted AppImage must fail the sidecar sha check.
if [ -f "$APPIMAGE" ]; then
  cp "$APPIMAGE" "$CACHE/corrupt.AppImage"
  cp "$APPIMAGE.sha256" "$CACHE/corrupt.AppImage.sha256"
  printf '\xff' | dd of="$CACHE/corrupt.AppImage" bs=1 seek=1000000 conv=notrunc status=none
  expect_fail "T-92 corrupted AppImage sha" $PY/check_appimage.py --file "$CACHE/corrupt.AppImage" --cache-dir "$CACHE" --smoke-timeout 1
else
  echo "SELFTEST SKIP: T-92 corrupt pin needs the cached AppImage — run run.sh first"
fi

# T-93 static: a timeout constant changed from 10 s must fail.
TAMPER="$CACHE/tampered-repo"
rm -rf "$TAMPER"
mkdir -p "$TAMPER/src/lib" "$TAMPER/tests"
cp "$REPO/src/lib/channel.ts" "$REPO/src/updates.ts" "$REPO/src/native.ts" "$REPO/src/main.tsx" "$TAMPER/src/" 2>/dev/null
cp "$REPO/src/lib/version.ts" "$TAMPER/src/lib/"
cp "$REPO/tests/checks.ts" "$TAMPER/tests/"
cp "$REPO/src/lib/channel.ts" "$TAMPER/src/lib/"
sed -i 's/UPDATE_CHECK_TIMEOUT_MS = 10_000/UPDATE_CHECK_TIMEOUT_MS = 99_999/' "$TAMPER/src/lib/version.ts"
expect_fail "T-93 static tampered timeout" $PY/check_update.py --mode static --repo "$TAMPER"
# T-93 static: CHECKED_KEY written before the decision must fail.
cp "$REPO/src/lib/version.ts" "$TAMPER/src/lib/version.ts"  # restore: isolate this pin
cp "$REPO/src/updates.ts" "$TAMPER/src/updates.ts"
python3 - "$TAMPER/src/updates.ts" <<'EOF'
import re, sys
p = sys.argv[1]
s = open(p).read()
# move the setItem line above the guard: delete it from the .then body and
# insert a bare write right after the function opens (simulates the CC-m8 bug).
s = s.replace("""    (completed) => {
      if (!completed) return;
      try {
        localStorage.setItem(CHECKED_KEY, String(Date.now()));""",
"""    (completed) => {
      try {
        localStorage.setItem(CHECKED_KEY, String(Date.now()));""")
open(p, "w").write(s)
EOF
grep -q "if (!completed) return;" "$TAMPER/src/updates.ts" || echo "(guard removed by tamper — good)"
expect_fail "T-93 static CHECKED_KEY written before decision" $PY/check_update.py --mode static --repo "$TAMPER"

# T-93 GUI negative: expecting quiet from an OLD binary must fail
# (the 1.6.0 AppImage is older than the live manifest, so the dialog fires).
if [ -f "$APPIMAGE" ]; then
  if [ -z "${DISPLAY:-}" ]; then
    DISP=""
    for d in 90 91 92 93 94 95 96 97; do
      if [ ! -e "/tmp/.X11-unix/X$d" ]; then DISP="$d"; break; fi
    done
    [ -n "$DISP" ] || { echo "SELFTEST FAIL: no free X display in 90..97" >&2; exit 1; }
    Xvfb ":$DISP" -listen tcp -screen 0 1280x800x24 >>"$CACHE/xvfb-selftest.log" 2>&1 &
    XVFB_PID=$!
    export DISPLAY="127.0.0.1:$DISP"
    for _ in $(seq 1 30); do
      [ -e "/tmp/.X11-unix/X$DISP" ] && xwininfo -root -tree >/dev/null 2>&1 && break
      sleep 1
    done
  fi
  expect_fail "T-93 GUI expect-quiet on old AppImage" $PY/check_update.py --mode gui --binary "$APPIMAGE" --expect quiet --cache-dir "$CACHE"
  [ -n "${XVFB_PID:-}" ] && kill "$XVFB_PID" 2>/dev/null
else
  echo "SELFTEST SKIP: T-93 GUI pin needs the cached AppImage — run run.sh first"
fi

echo
if [ "$FAIL" != 0 ]; then echo "SELFTEST RESULT: FAIL"; else echo "SELFTEST RESULT: PASS (every broken input failed as expected)"; fi
exit "$FAIL"
