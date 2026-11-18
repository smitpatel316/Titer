// Q-84 / U-01 — update dialog dismissed with "Later" (stay on this version).
//
// WHY wdio: the prompt is a NATIVE dialog (plugin-dialog `message`), so
// neither WebDriver nor MCP can see or click it — MCP has no update-dialog
// tool at all. The Linux leg drives it with xdotool and asserts the app
// stays on its version and opens no browser. The live check only offers
// when a newer release exists, which the suite cannot arrange, so the spec
// triggers the REAL prompt through the E2E hook with a fixed test version
// ("9.9.9-test"); the dialog, its buttons, and the answer handling are all
// production code.
//
// PIN: if "Later" returned true (regression in askToUpdate), the app would
// call open_link("releases") — the mocked invoke records the call and the
// spec fails. If Escape did not dismiss the dialog, the window-gone wait
// times out and the spec fails. If the dialog never appeared, the first
// wait fails.
import assert from "node:assert/strict";
import { switchToProjectWindow, waitForHook } from "./helpers/window.js";
import { dismissUpdateDialogIfPresent } from "./helpers/window.js";
import * as x from "./helpers/xdotool.js";
import { sleep, waitForWindow, waitForWindowGone, activateWindow, key } from "./helpers/xdotool.js";

const DIALOG_TITLE = "Titer 9.9.9-test is available";

describe("Q-84/U-01 update dialog dismisses with Later", () => {
  before(async () => {
    await switchToProjectWindow();
    await waitForHook();
    await dismissUpdateDialogIfPresent(x);
  });

  after(async () => {
    try {
      await browser.tauri.clearAllMocks();
    } catch {
      // Mocks are per-session; a missing clear is not a product failure.
    }
  });

  it("shows the update prompt, Later dismisses it, no browser opens", async () => {
    // Mock open_link in-page and record every call on the window: the
    // "Later" path must never reach it.
    const openLinkMock = await browser.tauri.mock("open_link");
    await openLinkMock.mockImplementation((args) => {
      window.__wdioOpenLinkCalls = [...(window.__wdioOpenLinkCalls || []), args];
    });

    // Fire the real prompt WITHOUT returning its promise: showUpdateDialog
    // awaits askToUpdate, and WebDriver awaits a returned promise — routing
    // it through callHook would deadlock the execute call until the dialog
    // is dismissed, and nothing could dismiss it. The void wrapper returns
    // immediately; the spec polls for the dialog below, and the answer is
    // stashed on the hook when the prompt resolves.
    await browser.tauri.execute(() => {
      void window.__titerE2E.showUpdateDialog();
    });
    const wid = await waitForWindow(DIALOG_TITLE, { timeout: 20000 });
    assert.ok(wid, `update dialog ${JSON.stringify(DIALOG_TITLE)} never appeared`);

    // Exactly one update dialog (a second would mean a double prompt).
    assert.equal(await x.countWindows(DIALOG_TITLE), 1, "more than one update dialog open");

    await activateWindow(wid);
    await sleep(400);
    await key("Escape");
    assert.ok(
      await waitForWindowGone(DIALOG_TITLE, { timeout: 10000 }),
      "update dialog did not dismiss on Escape (Later)",
    );

    // The prompt's answer is stashed on the hook by the app itself.
    await browser.waitUntil(
      async () =>
        (await browser.tauri.execute(() => window.__titerE2E?.lastUpdateAnswer)) === false,
      { timeout: 10000, timeoutMsg: "update prompt did not resolve false after Later" },
    );

    // No browser was opened for the (nonexistent) release.
    const calls = await browser.tauri.execute(() => window.__wdioOpenLinkCalls ?? []);
    assert.equal(calls.length, 0, `open_link was called after Later: ${JSON.stringify(calls)}`);

    // The app is still alive and responsive on the same version.
    const summary = await browser.tauri.execute(() => window.__titerE2E.projectSummary());
    assert.equal(summary.title, "Untitled", `title changed after Later: ${JSON.stringify(summary.title)}`);
  });
});
