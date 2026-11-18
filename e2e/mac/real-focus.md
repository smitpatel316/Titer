# Real-focus checks — Q-17, Q-24, Q-58, Q-68, Q-74

## Why device-route
Each of these was a single-occurrence observation where the driver
could not tell a real focus bug from its own click/key race. They need
a human-speed device run: real clicks, real keys, the window in front,
each repeated 3x. MCP cannot test focus at all; the Linux wdio specs
type into the grid only after an explicit cell click (which masks
exactly these questions).

## Common setup
Slot claimed; Mac idle; build installed + verified. Fresh project per
check (fresh window + fresh .hlx). Screenshot each step. A check PASSES
only if it behaves the same way 3/3 times; a 1/3 or 2/3 split is
UNCONFIRMED (note the split, do not call it a bug or a pass).

## Q-17 — grid keyboard focus after clicking sidebar "Table 1"
1. Click "Table 1" in the sidebar (real mouse).
2. Type `9` then ArrowDown WITHOUT clicking any cell.
3. PASS if `9` lands in the first cell (grid took focus from the
   sidebar click). FAIL (focus bug) if typing goes nowhere 3/3.
   Note: Q-68 below is the same question after Ctrl+Alt+T — keep the
   two results separate.

## Q-24 — analysis popupbutton opens the select dropdown
1. Run any analysis so its result view shows the popupbutton
   (the per-comparison control in the graph STATISTICS overlay run,
   QA T20).
2. Click the popupbutton (real mouse).
3. PASS if a native `<select>` dropdown opens (not the "Reload"
   context menu) AND keyboard navigation works (Down changes the
   selection, Enter confirms). Record which of the two appeared.

## Q-58 — wizard Next click not advancing at step 2
1. Open an unpaired t-test wizard (Ctrl+Alt+A → t-test), walk to
   step 2 ("Choose the second data set").
2. Click Next (real mouse) 3x, waiting 1 s between clicks.
3. PASS if a click advances (or the wizard advances on the first
   click 3/3 runs). If clicks never advance but Return does (the
   QA-LOG-LINUX observation), that is the UNCONFIRMED race — record
   click count vs Return, do not file as a bug yet.

## Q-68 — grid focus after Ctrl+Alt+T new table (L05 quirk)
1. Ctrl+Alt+T → New Table → Column.
2. Type `1` `2` `3` (15 values in the original report; 3 suffice)
   WITHOUT clicking a cell.
3. PASS if the values land (fresh table takes focus). If the table
   stays empty 3/3, click a cell once and type again: if values then
   land, the quirk is real (focus bug vs expected behaviour — file it
   as a focus question with the screenshots, not as a crash bug).

## Q-74 — close-out: dirty window, X-button close DOES prompt
(Linux `xdotool windowclose` closed a dirty window with NO save prompt;
the X-button path was never retested.)
1. Dirty a window (type a value in Table 1).
2. Click the window's red X (real mouse — NOT Cmd+W, NOT a shell kill).
3. PASS if the Save / Don't Save / Cancel sheet appears. FAIL if the
   window closes silently with unsaved work lost (screenshot the
   desktop + check the file was not written).
4. Answer Don't Save; assert the app stays up (other windows) or exits
   cleanly (last window) as appropriate.
