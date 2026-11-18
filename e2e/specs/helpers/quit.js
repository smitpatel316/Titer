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
import { sleep } from "./xdotool.js";

export const SAVE_PROMPT = "Do you want to save the changes you made to your project?";
export const APP_PATTERN = "target/debug/titer";

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
