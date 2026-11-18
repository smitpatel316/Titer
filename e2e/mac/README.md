# e2e/mac — Mac device-route scripts (ready to run)

These are the cases SSH/AX structurally cannot do (WKWebView contents
collapse over SSH; native sheets need real input). Each file is a
runbook for a Mac lane agent driving Smit's MacBook Air via the device
route: exact GUI steps + the SSH half (file/sha/process checks) + what
PASS looks like. Nothing here runs from Hatch; nothing here touches the
slot except through the claim file.

## Slot discipline (Mac-GUI-proof-process.md, Rule 4)

- Before ANY step: read `~/workspace/.helix-mac-slot/claim.json`.
  If a claim exists (e.g. battery-rerun-162), WAIT — do not quit-all,
  install, restore, or drive the GUI. These scripts never claim the slot
  themselves; the batch coordinator owns it.
- One shared install per batch: build the tip DMG once, verify sha/size
  (~100 MB binary, ~99 MB DMG — a 1.6 MB DMG with a 512-byte binary is
  truncated even when hdiutil calls it valid), install once, run ALL
  queued scenarios in one session, fresh window + fresh `.hlx` per
  feature. Restore the latest shipped release once at the end (sha +
  codesign + PID prove the restore; no post-restore About re-check).
- Never rapid-close windows via AX (crashes the app — BUG-12 family).
  Clear test windows: SIGTERM, back up + truncate
  `~/Library/Application Support/net.smitpatel.helix/open-projects` to
  0 bytes, relaunch.
- AX probes lie under load — retry 2–3× before concluding a negative.
- Never touch Smit's Downloads or anything outside the Helix dirs.
- Drive the GUI only when Smit is idle (HIDIdleTime); SSH build/install
  is fine any time.

## Scripts

| File | Cases | What it proves that nothing else can |
| --- | --- | --- |
| `cq05-real-mouse-quit.md` | CQ-05 | Quit sheet dismisses via a REAL mouse click (CGEvent), not just AX press |
| `m01-mcp-toggle.md` | M-01, S-06 OFF-default | MCP toggle via device-route AX; OFF by default on a fresh real build |
| `gridlines-g01-g12.md` | G-01..G-14 | Gridlines S1–S3 + tick controls + fresh defaults, on-device screenshots |
| `q03-paste-foreground.md` | Q-03 | Cmd+V paste of TSV in a FOREGROUND window with the real clipboard |
| `real-focus.md` | Q-17, Q-24, Q-58, Q-68, Q-74 | Real-focus checks (grid focus, popupbutton, wizard Next, close-out prompt) |
| `t87-updater-gate.md` | T-87 | Full updater loop: detect → download → sha → apply → relaunch → restore |
| `s01-s02-about-coffee.md` | S-01, S-02 | About text via AX; Buy Me a Coffee URL via Chrome history |

## What stays Linux/wdio (not here)

The Linux legs of the same cases live in `e2e/specs/` (xdotool drives
the GTK dialogs/choosers under Xvfb). If a script here finds its case
already proven by a wdio spec, it says so in the file — the Mac leg
then covers only the Mac-only remainder (real mouse, real clipboard,
real menu clicks, AX text).
