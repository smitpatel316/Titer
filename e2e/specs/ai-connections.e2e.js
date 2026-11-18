// S-06 — AI Connections dialog: renders, toggle ON → listening text.
//
// WHY wdio: the dialog is in-app React (native <dialog>), so WebDriver can
// read it and click its switch — but MCP cannot touch it by design:
// mcpSetEnabled is an app command, not an MCP tool, so no agent can change
// the safety settings. The switch must be located by DOM role, never by
// coordinates: on Linux/Xvfb its position varies per launch (the
// (300,336) vs (300,258) vs AX (510,336) history), and blind coordinate
// clicks are exactly how the old proof missed it.
//
// SCOPE NOTE: the E2E build auto-enables MCP on mount (AppShell, so the
// MCP suite needs no GUI click), so "OFF by default on a fresh launch"
// CANNOT be observed in this build — the dialog opens ON here. That leg
// belongs to the real build and is covered by the Mac device-route script
// e2e/mac/m01-mcp-toggle.md (M-01). This spec pins the toggle itself:
// ON → listening text + token + Claude Code command; OFF → off text;
// ON again → listening text. If the toggle did not start/stop the server,
// the text would not flip.
//
// PIN: the listening text names the live endpoint (127.0.0.1:port/mcp).
// A build where the toggle flipped the switch but never started the
// server would still show "Off" (or an error) and fail here.
import assert from "node:assert/strict";
import {
  switchToProjectWindow,
  waitForHook,
  isDialogOpen,
} from "./helpers/window.js";
import { dismissUpdateDialogIfPresent } from "./helpers/window.js";
import * as x from "./helpers/xdotool.js";
import { sleep } from "./helpers/xdotool.js";

const TITLE = "AI Connections";

async function openDialog() {
  // Settings > AI Connections… has the accelerator CmdOrCtrl+, — the real
  // menu path. If it ever stops firing under Xvfb, the hook is the
  // documented fallback (same openSelector call the menu item makes).
  await x.key("ctrl+comma");
  try {
    await browser.waitUntil(async () => isDialogOpen(TITLE), { timeout: 8000 });
    return "accelerator";
  } catch {
    await browser.tauri.execute(() => window.__titerE2E.openAiConnections());
    await browser.waitUntil(async () => isDialogOpen(TITLE), {
      timeout: 10000,
      timeoutMsg: "AI Connections dialog never opened (accelerator + hook)",
    });
    return "hook-fallback";
  }
}

async function switchState() {
  const sw = await $("input[role='switch']");
  await sw.waitForExist({ timeout: 10000 });
  const checked = await sw.isSelected();
  const text = await browser.tauri.execute(() => {
    const dlg = [...document.querySelectorAll("dialog")].find((d) => d.open);
    return dlg ? dlg.textContent : "";
  });
  return { checked, text };
}

describe("S-06 AI Connections dialog", () => {
  before(async () => {
    await switchToProjectWindow();
    await waitForHook();
    await dismissUpdateDialogIfPresent(x);
  });

  it("renders, toggle flips the server OFF and back ON with listening text", async () => {
    const via = await openDialog();
    // Record which trigger opened it; the accelerator is the real path.
    await browser.tauri.execute(
      (_tauri, v) => {
        window.__wdioAiConnectionsOpenedVia = v;
      },
      via,
    );

    let state = await switchState();
    // E2E build auto-enables MCP on mount: the dialog opens ON. (The
    // OFF-by-default leg lives in the Mac device-route script, M-01.)
    assert.equal(state.checked, true, `switch not ON on open in the E2E build (checked=${state.checked})`);
    assert.match(state.text, /On — listening on 127\.0\.0\.1:\d+\/mcp/, `no listening text while ON: ${JSON.stringify(state.text.slice(0, 300))}`);

    // Toggle OFF: the server stops, the text flips, the token/command
    // sections go away (they render only when enabled/running).
    const sw = await $("input[role='switch']");
    await sw.click();
    await browser.waitUntil(
      async () => (await switchState()).checked === false,
      { timeout: 15000, timeoutMsg: "switch did not turn OFF" },
    );
    state = await switchState();
    assert.match(state.text, /Off — no AI app can reach Titer\./, `no off text after toggle OFF: ${JSON.stringify(state.text.slice(0, 300))}`);

    // Toggle back ON: the server restarts and the listening text returns.
    await sw.click();
    await browser.waitUntil(
      async () => (await switchState()).checked === true,
      { timeout: 15000, timeoutMsg: "switch did not turn back ON" },
    );
    state = await switchState();
    assert.match(state.text, /On — listening on 127\.0\.0\.1:\d+\/mcp/, `no listening text after toggle ON: ${JSON.stringify(state.text.slice(0, 300))}`);
    assert.match(state.text, /Local token/, "token section missing while ON");
    assert.match(state.text, /Claude Code/, "Claude Code command section missing while running");

    await sleep(300);
    const done = await $("button=Done");
    await done.click();
    await browser.waitUntil(async () => !(await isDialogOpen(TITLE)), {
      timeout: 10000,
      timeoutMsg: "AI Connections dialog did not close on Done",
    });
  });
});
