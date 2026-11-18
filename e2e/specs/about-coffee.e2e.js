// S-01 + S-02 — About dialog + Help > Buy Me a Coffee.
//
// WHY wdio: both are NATIVE menu items (Titer > About Titer, Help > Buy Me
// a Coffee) opening a native About dialog / the OS browser. MCP has no
// menu or browser tool, so neither is MCP-reachable. WebDriver cannot see
// the native menu bar either, so the spec drives it by keyboard the way a
// user would: F10 focuses the GTK menu bar, arrows walk it, Enter
// activates. The menu ORDER is fixed by code (menus.ts + app-menu.ts),
// so the key counts below are exact, not guessed.
//
// SPLIT (Linux vs Mac): on Linux there is no OCR and no AT-SPI, so the
// About dialog's TEXT (name / version / copyright) cannot be asserted
// here — the spec asserts the dialog OPENS and screenshots it as evidence,
// and the text assertion lives in e2e/mac/s01-s02-about-coffee.md (AX
// reads the labels on the device). For Buy Me a Coffee the URL cannot be
// verified via a browser history on Linux either (no browser in the
// sandbox) — the spec mocks the `open_link` invoke and asserts the menu
// action fires it with { link: "coffee" }; the real browser-open half is
// the Mac device-route leg.
//
// PIN: S-02 — if the Help item's wiring broke (wrong action, or the menu
// never opened), the mock records nothing and the spec fails. S-01 — if
// the About item never opened its dialog, the window wait fails.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  switchToProjectWindow,
  waitForHook,
  specOutDir,
} from "./helpers/window.js";
import { dismissUpdateDialogIfPresent } from "./helpers/window.js";
import * as x from "./helpers/xdotool.js";
import { sleep, waitForWindow, waitForWindowGone, searchWindows, activateWindow, key } from "./helpers/xdotool.js";

const execFileAsync = promisify(execFile);
const OUT = specOutDir("about-coffee");

async function displayScreenshot(name) {
  const file = `${OUT}/${name}.png`;
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "x11grab",
    "-video_size",
    "1280x800",
    "-i",
    process.env.DISPLAY ?? ":99",
    "-frames:v",
    "1",
    file,
  ]);
  return file;
}

describe("S-01/S-02 About + Buy Me a Coffee", () => {
  before(async () => {
    await switchToProjectWindow();
    await waitForHook();
    await dismissUpdateDialogIfPresent(x);
  });

  after(async () => {
    try {
      await browser.tauri.clearAllMocks();
    } catch {
      // Best effort; mocks are per-session.
    }
  });

  it("S-01: Titer menu > About Titer opens the About dialog", async () => {
    const appWindows = await searchWindows("Untitled");
    assert.ok(appWindows.length > 0, "no Untitled project window");
    await activateWindow(appWindows[0]);
    await sleep(500);
    // F10 focuses the menu bar on the first menu (Titer); Down opens it
    // with "About Titer" selected; Enter activates it.
    await key("F10");
    await sleep(500);
    await key("Down");
    await sleep(500);
    await key("Return");
    const wid = await waitForWindow("About", { timeout: 10000 });
    assert.ok(wid, "About dialog never appeared after Titer > About Titer");
    await displayScreenshot("s01-about-dialog");
    // Dismiss: the About dialog has a Close button; Escape closes it.
    await key("Escape");
    assert.ok(await waitForWindowGone("About", { timeout: 10000 }), "About dialog did not dismiss on Escape");
  });

  it("S-02: Help > Buy Me a Coffee fires open_link coffee", async () => {
    const openLinkMock = await browser.tauri.mock("open_link");
    await openLinkMock.mockImplementation((args) => {
      window.__wdioOpenLinkCalls = [...(window.__wdioOpenLinkCalls || []), args];
    });

    const appWindows = await searchWindows("Untitled");
    await activateWindow(appWindows[0]);
    await sleep(500);
    // Menu order: Titer File Edit Table Analysis Graph Figure Info Sheet
    // Settings View Window Help — Help is the 12th menu (11 Rights from
    // the first). Down opens it on "Titer on GitHub"; Down again selects
    // "Buy Me a Coffee"; Enter activates it.
    await key("F10");
    await sleep(500);
    for (let i = 0; i < 11; i++) {
      await key("Right");
      await sleep(120);
    }
    await key("Down");
    await sleep(500);
    await displayScreenshot("s02-help-menu-open");
    await key("Down");
    await sleep(300);
    await key("Return");
    await sleep(1000);

    const calls = await browser.tauri.execute(() => window.__wdioOpenLinkCalls ?? []);
    assert.equal(calls.length, 1, `open_link should have been called once, got ${JSON.stringify(calls)}`);
    assert.deepEqual(calls[0], { link: "coffee" }, `open_link called with the wrong args: ${JSON.stringify(calls[0])}`);
  });
});
