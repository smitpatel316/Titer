# M-01 + S-06 (OFF-by-default leg) — MCP toggle via device-route AX

## Why device-route
The toggle lives in Settings → AI Connections, behind the NATIVE menu
bar (Settings menu, accelerator Cmd+,). On the Mac, SSH cannot reach
it: the menu is not AX-driven from a shell session, and the switch
coordinate varies per launch, so a blind click is how the old proof
missed it. The Linux wdio spec (`e2e/specs/ai-connections.e2e.js`)
covers the toggle round-trip in the E2E build — but that build
AUTO-ENABLES MCP on mount, so "OFF by default on a fresh launch" is
unobservable there. Only the real build, on the device, can prove it.

## Preconditions
- Slot claimed; Mac idle; REAL (non-E2E) build installed and verified
  (sha + size). Fresh app-data state for the OFF leg: quit Titer, then
  remove the MCP state so the launch is fresh — do NOT delete Smit's
  real app data; use a scratch HOME if the batch provides one, else
  note that the OFF leg ran with existing state and say so.
- SSH ready for the checks below.

## Steps
1. Launch Titer (device: Finder /Applications/Titer.app, or open -a
   from the device session — NOT `open -a` from SSH).
2. SSH: assert MCP is OFF after launch — nothing listening on 18741
   (`curl -s -m 2 http://127.0.0.1:18741/mcp` fails / connection
   refused) AND no `mcp/discovery.json` under the app-data dir.
   This is the OFF-by-default pin: a build that auto-enabled would
   already be listening.
3. Device: Settings → AI Connections… (menu click, or Cmd+,).
   Screenshot the dialog.
4. AX: read the dialog text. Assert it shows
   "Off — no AI app can reach Titer." and the switch is OFF.
5. AX: locate the switch (role AXCheckBox / switch) FRESH by AX each
   time — never a remembered coordinate — and click it ON.
6. Assert the dialog now shows "On — listening on
   127.0.0.1:18741/mcp", plus the Local token section and the
   "Claude Code — run once in a terminal" section.
7. SSH: assert the server answers — `curl -s -m 2
   http://127.0.0.1:18741/mcp` returns an MCP response (or at least a
   connection + protocol reply, not refused), and
   `mcp/discovery.json` exists under the app-data dir.
8. AX: click the switch OFF again. Assert the off text returns.
9. SSH: assert nothing listens on 18741 again.
10. Click Done. Screenshot.

## PASS
- Fresh launch: OFF, nothing on 18741, no discovery file.
- Toggle ON: listening text + token + Claude Code sections, server
  answers on 18741, discovery file present.
- Toggle OFF: off text, port quiet again.
- Evidence: the three screenshots + the SSH command outputs.

## FAIL
- Server already listening on a fresh launch (auto-enable shipped in
  the real build), toggle does not flip the text, or the port stays
  open after OFF. Record the AX dump + `lsof -i :18741`.
