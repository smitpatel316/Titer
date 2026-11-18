# Q-03 — Cmd+V paste of TSV fills cells (FOREGROUND window, real clipboard)

## Why device-route
Paste failed 3x in a BACKGROUND window (QA-LOG T02 note) and was never
confirmed in a foreground one. Whether the failure is focus or paste
logic can only be settled with the window in front and the real
clipboard — synthetic xdotool typing is not a paste, and MCP
`write_table` bypasses the paste path entirely.

## Preconditions
- Slot claimed; Mac idle; build installed + verified.
- Fresh project, Table 1 (Column) active.

## Steps
1. SSH (or device terminal): put a TSV on the real clipboard —
   `printf '1\t2\t3\n4\t5\t6\n7\t8\t9\n' | pbcopy`.
   Verify with `pbpaste` (must show the three lines, tabs intact).
2. Device: click the Titer window's TITLE BAR first (real mouse) so
   the window is foreground AND focused — do not rely on it already
   being frontmost. Screenshot to confirm focus (title bar active).
3. Device: click the first data cell (column A, row 1) with the real
   mouse, then press Cmd+V (device keyboard).
4. Assert: cells A1:C3 hold 1..9 in order (read the grid on screen;
   screenshot). Then Save As `~/q03-paste.hlx` and SSH-verify the
   values in the file bytes.
5. Repeat the paste once more in a SECOND table (new table via
   Ctrl+Alt+T → Column) to rule out a first-table fluke.

## PASS
- Both pastes land 1..9 in A1:C3, in the foreground window, from the
  real clipboard; the saved file holds the values.

## FAIL — classify, do not just re-run
- If the paste lands nowhere: note whether the window was truly
  foreground (title-bar state in the screenshot) and whether the
  cell had keyboard focus (caret visible). Retry once after
  re-clicking the cell. Two foreground failures = a real paste bug:
  file it with the screenshots + the pbpaste output.
- If the paste lands SHIFTED (wrong start cell): record the start
  cell vs the landed cells — a focus/anchor bug, not a paste bug.
