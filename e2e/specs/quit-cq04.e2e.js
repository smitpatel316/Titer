// CQ-04 — quit flow, single dirty window: exactly 1 sheet → Don't Save → clean exit.
//
// WHY wdio: same native save prompt as CQ-01 (see that file) — the
// single-window control for the three-window case. MCP close skips the
// prompt by design, so only the GUI path exercises it.
//
// PIN: exactly one prompt appears (not zero, not two), Don't Save dismisses
// it, and the app exits. A build that prompted twice for one window, or
// that never prompted (silent discard — the Q-74 observation class),
// fails here.
import assert from "node:assert/strict";
import {
  switchToProjectWindow,
  waitForHook,
} from "./helpers/window.js";
import { dismissUpdateDialogIfPresent } from "./helpers/window.js";
import * as x from "./helpers/xdotool.js";
import {
  waitForWindow,
  waitForWindowGone,
  countWindows,
  answerNativeDialog,
  waitForProcessGone,
} from "./helpers/xdotool.js";
import { SAVE_PROMPT, APP_PATTERN, dirtyCurrentWindow } from "./helpers/quit.js";

describe("CQ-04 single dirty window quit", () => {
  before(async () => {
    await switchToProjectWindow();
    await waitForHook();
    await dismissUpdateDialogIfPresent(x);
  });

  it("one sheet, Don't Save, clean exit", async () => {
    await dirtyCurrentWindow();
    await x.key("ctrl+q");
    const wid = await waitForWindow(SAVE_PROMPT, { timeout: 20000 });
    assert.ok(wid, "save prompt never appeared on quit (silent discard?)");
    assert.equal(
      await countWindows(SAVE_PROMPT),
      1,
      `expected exactly 1 save prompt for one window, saw ${await countWindows(SAVE_PROMPT)}`,
    );
    await answerNativeDialog(SAVE_PROMPT, "second");
    assert.ok(
      await waitForWindowGone(SAVE_PROMPT, { timeout: 10000 }),
      "save prompt did not dismiss on Don't Save",
    );
    // Node-side only from here — the wdio session dies with the app.
    assert.ok(
      await waitForProcessGone(APP_PATTERN, { timeout: 20000 }),
      "app process still alive after Don't Save on quit",
    );
  });
});
