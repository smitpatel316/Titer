# S-01 + S-02 — About text (AX) + Buy Me a Coffee URL (Chrome history)

## Why device-route
On Linux there is no OCR and no AT-SPI, so the About dialog's TEXT
cannot be asserted by the wdio spec (`e2e/specs/about-coffee.e2e.js`
only proves the dialog OPENS). The text lives in the native dialog's
AX tree, which the device route CAN read. Likewise the coffee URL can
only be verified end-to-end by watching a real browser open it —
Chrome history at click time. MCP has no menu, dialog, or browser tool.

## Preconditions
- Slot claimed; Mac idle; build installed + verified (sha + size).
  Note: About version CANNOT discriminate branch builds
  (package.json is unbumped on branches — every branch build reports
  the same version). Use sha for build identity, About only for the
  text content. A branch touching menus/About keeps its own smoke in
  its own brief (process Rule 2 exception).

## S-01 — About dialog text
1. Device: Titer menu → About Titer (real click).
2. AX: dump the About dialog/window tree. Assert:
   - Name shows "Titer".
   - Version shows the expected version for THIS build
     (e.g. shipped 1.6.1 → "Version 1.6.1"; record what it shows).
   - Copyright shows "© 2026 mickaphd" (bundle line) and the dialog
     carries "Free and open source. No warranty."
   - Credits (macOS panel renders `src-tauri/Credits.rtf`) show the
     tagline "Scientific data analysis, simplified." and the
     "Buy Me a Coffee: https://www.buymeacoffee.com/smitpatel316" line.
3. Screenshot the dialog. Dismiss (Close button / Escape).

## S-02 — Buy Me a Coffee opens the URL
1. Device: quit Chrome first (clean history baseline), or note the
   latest history timestamp before the click.
2. Device: Help → Buy Me a Coffee (real click).
3. Assert: Chrome (default browser) opens
   `https://www.buymeacoffee.com/smitpatel316` — verify in Chrome's
   history at click time (the URL appears with a timestamp matching
   the click), not just that a window opened.
4. Screenshot the browser tab showing the URL.

## PASS
- S-01: all four text assertions hold in the AX dump.
- S-02: the exact URL opens in Chrome with a matching history entry.
- Evidence: the AX dump + the two screenshots.

## FAIL
- About shows a stale/wrong version for a SHIPPED build (branch
  builds excluded — see the note above), missing credits, or the
  coffee click opens anything other than the exact URL. Record the
  AX dump + the history entry.
