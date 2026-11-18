# T-87 — updater E2E gate (full loop on the Mac)

## Why device-route
The updater swaps the app bundle and relaunches it — that is an
OS-level install flow (download → sha → stage → helper swap on exit →
relaunch as the new version → restore). No MCP tool and no WebDriver
command can do it; the Linux build has no installable asset at all
(the offer opens the releases page instead). Only the Mac device run
proves the loop.

## Preconditions
- Slot claimed; Mac idle. The test needs a TEST channel manifest
  advertising a test version (e.g. 1.1.1-test) with a built asset
  (zip), its sha256, and its size — prepared by the release
  coordinator before this run. The v1.1 run's numbers (download
  100,574,118 B, sha matches manifest = built zip) are the reference,
  not this run's values.
- The installed app is the CURRENT version (e.g. 1.1.0); record its
  binary md5 + Info.plist version + PID before starting.

## Steps
1. Point the app at the test channel (per the coordinator's note for
   this run — test manifest URL / local override).
2. Trigger the check (Titer → Check for Updates…, or relaunch and let
   the daily check fire).
3. Assert the offer appears: "Titer <test-version> is available",
   Update Now offered. Screenshot.
4. Click Update Now (device). Watch the download: assert the
   downloaded bytes equal the manifest size and the sha256 matches
   the manifest (the app checks this itself — record its "Update
   Downloaded" alert; ALSO verify independently via SSH: the staged
   file's `shasum -a 256` vs the manifest).
5. Assert the app quits through the normal flow (dirty windows still
   get their save prompt — cancel one quit to prove it, then confirm)
   and relaunches AS THE TEST VERSION: About shows the test version,
   binary md5 matches the downloaded asset.
6. Negative check: relaunch / check again — the check is now quiet
   (no offer; the test version is current). Screenshot.
7. RESTORE the real current version: reinstall the real build, verify
   via SSH (binary md5, Info.plist version, PID) — no post-restore
   About re-check needed (sha + codesign + PID prove it).

## PASS
- Offer → download (size + sha match manifest) → applied → relaunched
  as the test version (About + binary md5) → negative check quiet →
  real version restored (SSH-verified md5, plist, PID).

## FAIL / caveats
- The production-URL live-GET leg is untestable pre-publish (v1.1
  caveat) — record it as untestable, not as a failure.
- Any sha/size mismatch aborts the run: do NOT click through it.
  Record the manifest values vs the downloaded values.
- If the helper swap leaves the app unlaunched, capture the helper
  log + `sample` the PID before touching anything.
