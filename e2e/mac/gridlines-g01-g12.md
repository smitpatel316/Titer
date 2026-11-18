# G-01..G-14 — gridlines + tick controls, on the device (S1–S3)

## Why device-route
SSH/AX is STRUCTURALLY unable to do this check: WKWebView contents
collapse over SSH, so the gridlines cannot be seen or clicked from a
shell session. The Nov 17 device-route proof (S1–S3 ALL PASS on shipped
1.6.1) is the pattern; this script re-runs it as an E2E gate so it
never goes back to manual. The Linux wdio specs cannot cover it either
— gridline rendering is a Plotly canvas, not DOM.

## Preconditions
- Slot claimed; Mac idle; build installed + verified (sha + size + PID).
- Fixture: `~/gridlines-proof.hlx` (+ `.base` backup). Work on a COPY
  (`~/gridlines-proof-<version>.hlx`); the originals stay pristine
  (236,687 B, Nov 14). Baseline in the file: g_scat gridX="none",
  gridY="none", tickDirection="outside", tickLength=5.

## Opening the fixture (G-13)
File > Open… search suggestions are NOT clickable via AX (AXPress
-25205) and coordinate clicks are dead inside the sheet; Cmd+Space is
blocked as a system shortcut; open_app refuses .hlx. Open via Finder:
scroll the date-sorted home list to the fixture and double-click it.
It opens in the existing Titer window.

## Migration dialog (G-14)
On open, "Project Updated" appears (older file). Assert it appears,
click OK, assert it dismisses, assert the FILE is unchanged on disk
(sha) until Save As. Save As the work copy; re-verify the baseline in
the copy.

## S1 — XY gridlines (G-01..G-05), graph g_scat "Scatter (unsorted X)"
After EACH toggle: save, then verify in the FILE (SSH: parse the .hlx
JSON for g_scat's gridX/gridY/tickDirection/tickLength) + screenshot.
| Step | Click | File must read | Screenshot must show |
| --- | --- | --- | --- |
| G-01 | Y gridlines "Major" | gridY="major" | horizontal lines at Y=1..5 |
| G-02 | Y "Major + minor" | gridY="major-minor" | denser lines, minors fainter |
| G-03 | Y "None" | gridY="none" | no gridlines |
| G-04 | X "Major" | gridX="major" | vertical lines at X=1..5, no horizontals |
| G-05 | X "None" | gridX="none", gridY="none" | baseline restored |

## S2 — Column graph gridlines (G-06)
Graph menu > New Graph… > "Mean or Median and Error" from the
"Outlier data" column table. Fresh graph defaults none/none/outside/5
(G-11 — verify in the file BEFORE any toggle). Click Y "Major":
file gridY="major" for the new graph (g_scat untouched); screenshot
shows the single black column (mean ~14.3, error bar ~18) with
horizontal gridlines at Y=2..18.

## S3 — Tick controls (G-07..G-10), g_scat
| Step | Click | File must read | Screenshot must show |
| --- | --- | --- | --- |
| G-07 | Tick direction "Inside" | tickDirection="inside" | ticks point into the plot |
| G-08 | Tick direction "None" | tickDirection="none" | no tick marks on either axis |
| G-09 | Restore "Outside", then "Increase tick length" once | tickLength=6, direction outside | inspector shows Tick length 6 |
| G-10 | "Decrease tick length" once | tickLength=5, Reset button gone | baseline restored |

## G-12 — screenshot-only evidence
Intermediate toggle states leave NO file trace (the final file restores
baseline), so the screenshots ARE the evidence for G-01/G-02/G-04/
G-06/G-07/G-08/G-09. Name them `gridlines-shots/s1-y-major.jpg`
etc. (same names as the Nov 17 proof) and keep them with the batch log.

## Close-out
- Final file state (saved): g_scat none/none/outside/5; the S2 column
  graph gridY="major" retained as evidence.
- Originals pristine (sha unchanged). App left running as found.
- Plane item flipped by the coordinator on acceptance, not by this run.

## PASS
- Every file-state assertion matches after its toggle; every screenshot
  shows the described rendering; originals untouched.
