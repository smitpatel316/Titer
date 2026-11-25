// MAC-DRIVER — Mac device-route spec for e2e/specs/helpers/mac-driver.js.
//
// WHY wdio on the Mac: the native menu bar is real NSMenus (the app-menu
// items WORK on macOS, unlike Linux where the predefined Quit/Services
// items are disabled), and neither WebDriver nor MCP can see or click
// it. This spec proves the driver itself: it reads a real menu's items
// and clicks a real menu item, end to end, on the device.
//
// MAC-ONLY: skipped on any other platform (describe.skip). It assumes the
// app is already running under the wdio service (as every conversion spec
// does) and uses ONLY the mac-driver — no window.js/grid.js imports, so
// it stays runnable the moment the driver lands, before the rest of the
// conversion harness is in place.
//
// PIN: if the driver cannot reach the menu bar (wrong process name, AX
// denied, menu path wrong), menuItems returns [] and the first test
// fails; if the one-call menu click does not land, no new window appears
// and the second test fails. A driver that silently no-ops fails here.
import assert from "node:assert/strict";
import * as mac from "./helpers/mac-driver.js";

const isMac = process.platform === "darwin";

// The standard About panel carries no title bar text, so it is counted,
// not named: poll the total window count instead of waiting on a title
// (waitForWindow("") would match the first window at once, and
// waitForWindowGone("") would wait for the whole app to close).
async function waitForWindowCount(target, { timeout = 10000, interval = 500 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if ((await mac.countWindows("")) === target) return true;
    if (Date.now() > deadline) return false;
    await mac.sleep(interval);
  }
}

(isMac ? describe : describe.skip)("mac-driver: native menus via AppleScript", () => {
  it("lists the Help menu with the seq 432 entries", async () => {
    await mac.activateApp();
    const items = await mac.menuItems("Help");
    const titles = items.map((i) => i.title);
    for (const entry of [
      "Titer on GitHub",
      "User Guide",
      "Titer Tips",
      "Buy Me a Coffee",
      "Sample Project",
    ]) {
      assert.ok(
        titles.includes(entry),
        `Help menu is missing ${JSON.stringify(entry)} (saw: ${titles.join(" | ")})`,
      );
    }
  });

  it("opens About via the Titer menu and closes it again", async () => {
    await mac.activateApp();
    // The standard About panel carries no title bar text, so it is
    // counted, not named: one more window after the click, one fewer
    // after Escape (the runbook's dismiss path for the panel).
    const before = await mac.countWindows("");
    await mac.clickMenuItem("Titer", "About Titer");
    assert.ok(
      await waitForWindowCount(before + 1, { timeout: 10000 }),
      `no new window appeared after Titer > About Titer (still ${await mac.countWindows("")}, was ${before})`,
    );
    await mac.key("Escape");
    assert.ok(
      await waitForWindowCount(before, { timeout: 10000 }),
      `About panel did not close on Escape (still ${await mac.countWindows("")}, was ${before})`,
    );
  });
});
