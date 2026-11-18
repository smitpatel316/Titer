// The launch smoke (check/e2e-ci).
//
// WebdriverIO is the THIN GUI smoke only — it proves the built app launches
// and its main window appears. It is NOT the regression suite: functional
// coverage (import → analysis → export → reopen → verify) lives in
// e2e/mcp/ and is driven through the in-process MCP server, identically on
// Linux and Mac, with no display-automation fragility.
//
// What this asserts (all three must hold):
//   1. The debug binary launches and a project window appears (not just the
//      hidden engine window).
//   2. The app shell mounted — the E2E hook (window.__titerE2E) is installed
//      by a React useEffect in AppShell, so its presence proves the frontend
//      booted, not just that a window opened.
//   3. The window has a non-empty title (the app set its document title).
//
// The Convert spec that used to live here (convert.e2e.js) is RETIRED: it
// passed 2/2 on the pre-fix build too, so it discriminated nothing — the
// unit-test pin stays the regression test for the Convert-stall bug class.
// Do not re-add a GUI spec that passes on broken code; new functional
// coverage goes in e2e/mcp/ with a pre-fix FAIL / post-fix PASS pin.
import assert from "node:assert/strict";

const HOOK_TIMEOUT = 60000;

// The app is an engine window (hidden, runs webR) plus one window per project.
// The session may start on either — find the project window by URL, then tell
// the tauri service its label: the service defaults every execute/mock to the
// window labelled "main", which this app does not have (its windows are
// "project-1", "engine"), so without switchWindow every browser.tauri.* call
// fails with "Window 'main' not found".
async function switchToProjectWindow() {
  const handles = await browser.getWindowHandles();
  for (const handle of handles) {
    try {
      await browser.switchToWindow(handle);
      const url = await browser.getUrl();
      if (!url.includes("engine")) {
        await browser.tauri.switchWindow(handle);
        return;
      }
    } catch {
      // A hidden window may refuse the switch; try the next handle.
    }
  }
  throw new Error(`no project window among ${handles.length} handles`);
}

// The daily update check can pop a "1.0.9 available" dialog on first launch
// (fresh app-data dir). Dismiss it if it is there; no-op if it is not.
async function dismissUpdateDialog() {
  try {
    const later = await $("button=Later");
    if (await later.isExisting()) await later.click();
  } catch {
    // No update dialog — nothing to dismiss.
  }
}

describe("launch smoke", () => {
  before(async () => {
    await switchToProjectWindow();
    await dismissUpdateDialog();
  });

  it("launches with a project window and a mounted app shell", async () => {
    // The hook is installed by a React useEffect in AppShell, so on a slow
    // cold start (Linux, webR booting) it may not exist yet when the spec
    // runs. Poll for it — a missing hook here would be a harness race, not a
    // product failure, only after the timeout.
    await browser.waitUntil(
      async () =>
        (await browser.tauri.execute(() => typeof window.__titerE2E?.openConverter)) ===
        "function",
      { timeout: HOOK_TIMEOUT, timeoutMsg: "e2e hook window.__titerE2E.openConverter never appeared" },
    );
    const title = await browser.tauri.execute(() => document.title);
    assert.equal(typeof title, "string");
    assert.ok(title.length > 0, `expected a non-empty document title, got ${JSON.stringify(title)}`);
  });
});
