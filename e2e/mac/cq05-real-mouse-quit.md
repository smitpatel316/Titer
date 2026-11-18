# CQ-05 — quit sheet dismisses via REAL mouse click (CGEvent)

## Why device-route
The wdio quit specs (CQ-01..CQ-04, `e2e/specs/quit-cq0*.e2e.js`) drive
the native save prompt with keyboard (Tab/Space/Escape) under Xvfb.
A sheet that accepts keyboard input but ignores a real mouse click is
still broken for a user — and the v1.6.0 Mac proof already found one
undismissable native dialog this way (D-01's native alert: OK ignored
via AX, clicks, Return/Space/Esc). Only a CGEvent click on the device
closes this gap. SSH/AX cannot do it: AXPress is not a mouse click,
and coordinate clicks are dead inside a sheet.

## Preconditions
- Slot claimed by the batch coordinator; Mac idle; shipped-or-tip build
  installed and verified (sha + size). Note the build + PID in the log.
- One dirty project window: open a fresh project, click a grid cell,
  type `5`, ArrowDown. Window title "Untitled", dirty dot present.

## Steps
1. Press Cmd+Q (device keyboard).
2. Wait for the save sheet on the window: AX title
   "Do you want to save the changes you made to your project?",
   buttons Save / Don't Save / Cancel. Screenshot.
3. Read the "Don't Save" button's AX frame (AXPosition + AXSize).
   Do NOT click by a remembered coordinate — read the frame fresh.
4. Dispatch a REAL mouse click at the frame centre (CGEvent
   kCGEventLeftMouseDown + kCGEventLeftMouseUp, same point).
5. Assert: the sheet is gone (AX count of sheets on the window is 0)
   AND the app process has exited within 10 s
   (`pgrep -x Titer` empty; via SSH). Screenshot the desktop.
6. Repeat once with a second dirty window, this time real-clicking
   **Save** — the Save Project sheet appears; type a name, press
   Return; assert the `.hlx` file exists on disk (size > 0, valid
   JSON) and the app exits.

## PASS
- Both real clicks dismiss their sheet; no AX press was used; the app
  exits cleanly both times; the Save leg's file is on disk.
- Evidence: the two screenshots + the AX frames + the file listing.

## FAIL (file as a bug, do not waive)
- The click lands but the sheet stays (button highlights, nothing
  happens), or the sheet dismisses but the app does not exit, or the
  click hits the wrong button (wrong frame read). Record the AX dump
  of the sheet and the click coordinates.
