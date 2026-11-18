# e2e/release — scripted release verification (T-88..T-93)

Release/website/updater checks for the E2E-conversion program (Plane seq
187). Stdlib-only Python + shell; every script exits non-zero on failure
and prints one `PASS:` / `FAIL:` / `SKIP:` line per assertion. No heavy
builds, read-only against live services (GitHub API, titer.smitpatel.net)
— no publishes, no deploys, no release creation.

## Legs

| Script | Check | Runs on Hatch |
|---|---|---|
| `check_dmg.py` | T-88, S-04/S-05: DMG size/sha, build-start freshness, hdiutil VALID, mounted binary size/md5, codesign, installed binary md5, About version (Info.plist) | size/sha/freshness only; hdiutil/codesign/install legs `SKIP (MAC-OWED)` |
| `check_github_release.py` | T-89: release live, expected asset set, sizes + shas by re-download | yes |
| `check_channel_manifest.py` | T-90: manifest version/build per release, Linux entry carried over verbatim, asset URLs + sizes (+ shas with `--verify-asset-sha`) | yes |
| `check_website.py` | T-91: site 200, byte-identical after stripping Cloudflare's two edge injections, download links resolve with correct sizes, displayed SHAs == re-downloaded SHAs, current SHA present / previous SHA absent, `shortly` absent | yes |
| `check_appimage.py` | T-92: AppImage size + `sha256sum -c` semantics, smoke via `--appimage-extract-and-run` under Xvfb | yes |
| `check_update.py` | T-93: static CC-m8 invariants (10 s timeout, CHECKED_KEY written only after a decision, dialog title, startup wiring, decideUpdate unit coverage); GUI leg watches for the `Titer <ver> is available` dialog window on launch | static yes; GUI yes on Linux (AppImage), Mac leg owed |
| `run.sh` | Runs the Linux-runnable legs in order, shared download cache | yes |
| `selftest.sh` | Negative controls: every check run against deliberately broken input; asserts it FAILS | yes |

## Running

```sh
bash e2e/release/run.sh [--version 1.6.1] [--skip-gui]
bash e2e/release/selftest.sh   # pins: broken input must fail
```

Versions default to the latest live release (via `gh api
repos/smitpatel316/Titer/...` — explicit repo, never bare `gh`, which can
resolve upstream mickaphd/Helix). Downloads land in `e2e/out/release/`
(gitignored) and are reused across legs. `run.sh` starts its own Xvfb on
a private display when `DISPLAY` is unset.

## Reference versions (verified 2026-11-18)

- Latest live release: **v1.6.2** (shipped during this lane's first run:
  DMG + zip + AppImage + AppImage.sha256). The lane was written when
  v1.6.1 was latest — T-89 against an unreleased version correctly
  FAILS until it ships.
- Channel manifest: version **1.6.1**, build **10**; mac latest 1.6.1/build
  10; linux latest **1.6.0**/build 9 (carried over verbatim). NOTE: after
  v1.6.2 shipped, the manifest + website still serve 1.6.1 — T-90's
  linux-latest check FAILS until the channel is flipped to 1.6.2. That
  is the check working, not a script bug.
- Latest AppImage release: **v1.6.2** (173,140,472 B); previous 1.6.0
  (190,994,936 B).
- Website: served page is byte-identical to
  `~/workspace/your_files/titer-homepage/titer-homepage.html` after
  stripping Cloudflare's two injections (hidden `cdn-cgi` anchor, 304 B,
  + `__CF$cv$params` challenge script, 1114 B).

## The update-dialog GUI leg, precisely

`check_update.py --mode gui --expect auto` derives the expectation from
the binary's version against the newest available version, defined as
max(channel manifest, main-branch package.json) — the app reads the
manifest first and falls back to the package.json when the manifest
does not answer (observed: in this sandbox the 1.6.0 AppImage's dialog
says "Titer 1.6.2 is available", i.e. the fallback answered). The leg
watches windows by ID (titles repeat across apps on a shared display)
and asserts the main window appears too, so a hung check cannot pass.

## Pins (pre-fix FAIL / post-fix PASS)

Each check was run against deliberately broken input in `selftest.sh`
and fails there: truncated DMG (the 1.6 MB / 512-byte-binary trap class),
wrong SHA, stale DMG (mtime before the build-start stamp), nonexistent
release, tampered site source, corrupted AppImage, tampered 10 s timeout,
CHECKED_KEY written before the decision, and `--expect quiet` on an old
binary (the dialog fires). A check that passes on broken input does not
ship.

## Mac-owed (run on the Mac or CI e2e-mac)

- T-88: `hdiutil verify`, mounted-binary size/md5, `codesign --verify`
  (mounted + installed), installed binary md5 == DMG binary md5,
  installed-app version (Info.plist read — the automatable form of the
  About-dialog check).
- T-93 GUI legs with a Mac binary (same script, `--binary <Mac app
  bundle executable>`): dialog leg needs an older Mac build, quiet leg
  a current one. Both legs run green on Hatch via AppImages (previous
  release → dialog, latest release → quiet).
