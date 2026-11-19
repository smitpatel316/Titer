// Quit-flow helpers (CQ-01..CQ-04): dirty windows, open extra windows.
//
// Quitting ends the wdio session (the app process exits), so every quit
// spec is the LAST thing its file does, and all post-quit assertions are
// node-side (xdotool / process polling / files on disk) — never browser.*
// calls after the quit starts, except in CQ-02 where Cancel aborts the
// quit and the session survives.
import assert from "node:assert/strict";
import { projectWindowHandles, switchToHandle, projectSummary } from "./window.js";
import { typeColumnAValues } from "./grid.js";
import { sleep, searchWindows, activateWindow } from "./xdotool.js";

export const SAVE_PROMPT = "Do you want to save the changes you made to your project?";
export const APP_PATTERN = "target/debug/titer";

// X-focus a visible project window. xdotool key goes to the X-focused
// window and the wdio driver never X-focuses the app window — without
// this, Ctrl+N lands nowhere (CQ-01's new windows never open). Same
// pattern as about-coffee (searchWindows("Untitled") + activateWindow),
// proven live. (Ctrl+Q is NOT fixed by focus — it is dead on Linux for
// a different reason; see quitApp below.)
export async function focusProjectWindow() {
  const ids = await searchWindows("Untitled");
  assert.ok(ids.length > 0, "no visible Untitled project window to focus");
  await activateWindow(ids[0]);
  await sleep(500);
}

// Quit the app through its own quit flow: invoke the `quit_app` Tauri
// command (src-tauri/src/main.rs), the same flow the macOS quit hook and
// the updater use — it marks the quit, closes project windows one at a
// time, and each dirty window shows its native save prompt.
//
// WHY NOT the menu / Ctrl+Q (settled 2026-11-18 by screenshot proof):
// on Linux the Titer menu's predefined macOS items — Services, Hide
// Titer, Hide Others, Show All, Quit Titer — are all DISABLED (greyed;
// muda marks macOS-only predefined items insensitive on Linux), so
// keyboard nav cycles only About Titer / Check for Updates…, the "q"
// letter-jump and End key move at most one step, and Ctrl+Q has no
// working accelerator (muda predefined Quit carries none on Linux).
// There is NO menu quit path on Linux in this build; the menu item
// cannot be the trigger. The invoke below exercises the real quit flow
// (prompt → Cancel / Don't Save / Save) end to end; the disabled menu
// item itself is a separate app gap, filed for triage.
export async function quitApp() {
  await focusProjectWindow();
  await browser.tauri.execute((_tauri) => _tauri.core.invoke("quit_app"));
}

// Make the CURRENT window dirty by typing one value into its grid.
export async function dirtyCurrentWindow(value = "777") {
  await typeColumnAValues([value]);
  const summary = await projectSummary();
  assert.equal(summary.isDirty, true, "window did not become dirty after typing");
}

// Open a new project window (Ctrl+N via xdotool) and return its handle.
// Polls until the new handle appears.
export async function openNewWindow(x, { timeout = 20000 } = {}) {
  const before = await projectWindowHandles();
  await x.key("ctrl+n");
  const deadline = Date.now() + timeout;
  for (;;) {
    const handles = await projectWindowHandles();
    const fresh = handles.find((h) => !before.includes(h));
    if (fresh) return fresh;
    if (Date.now() > deadline) throw new Error("no new project window appeared after Ctrl+N");
    await sleep(500);
  }
}

// Dirty every project window: switch to each, type a value.
export async function dirtyAllWindows(x) {
  const handles = await projectWindowHandles();
  for (const handle of handles) {
    await switchToHandle(handle);
    await dirtyCurrentWindow();
  }
  return handles;
}
