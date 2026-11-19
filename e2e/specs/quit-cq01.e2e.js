// CQ-01 — quit with 3 dirty windows: exactly ONE save sheet at a time.
//
// WHY wdio: the save prompt is a NATIVE dialog (askToSave via plugin-dialog
// `message`) shown per window by the shell's close-requested handler, so
// neither WebDriver nor MCP can drive it — MCP close deliberately skips
// the prompt (one-shot allowance, mcp-document.ts). The multi-window
// sequencing is GUI-only.
//
// PIN: the pre-fix bug showed 3 CONCURRENT prompts (the third a standalone
// dialog accepting no input). The fix serializes them (one in-flight
// confirm per window, confirmDiscardInFlight). The spec counts the native
// dialog windows after each answer: exactly 1 at every step. A pre-fix
// build shows 3 at the first count and fails here. The quit completes
// only after all three sheets are answered — a build that dropped a sheet
// would leave the process alive and fail the final wait.
import assert from "node:assert/strict";
import {
  switchToProjectWindow,
  waitForHook,
  switchToHandle,
} from "./helpers/window.js";
import { dismissUpdateDialogIfPresent } from "./helpers/window.js";
import * as x from "./helpers/xdotool.js";
import {
  sleep,
  waitForWindow,
  waitForWindowGone,
  countWindows,
  answerNativeDialog,
  waitForProcessGone,
} from "./helpers/xdotool.js";
import { SAVE_PROMPT, APP_PATTERN, dirtyAllWindows, focusProjectWindow, quitApp } from "./helpers/quit.js";

describe("CQ-01 quit with 3 dirty windows, one sheet at a time", () => {
  before(async () => {
    await switchToProjectWindow();
    await waitForHook();
    await dismissUpdateDialogIfPresent(x);
  });

  it("shows exactly one save sheet at a time; Don't Save x3 exits cleanly", async () => {
    // Three dirty windows: the launch window + two new ones. (Ctrl+N is
    // an xdotool key: it needs an X-focused window first, same as Ctrl+Q.)
    await focusProjectWindow();
    await x.key("ctrl+n");
    await sleep(1500);
    await x.key("ctrl+n");
    await sleep(1500);
    const handles = await dirtyAllWindows(x);
    assert.equal(handles.length, 3, `expected 3 project windows, got ${handles.length}`);

    // Focus any window and quit the app (quit_app invoke — see
    // helpers/quit.js; the Linux menu Quit item is disabled).
    await switchToHandle(handles[0]);
    await sleep(500);
    await quitApp();

    // Three sheets, strictly sequential: exactly one native dialog at a
    // time, each answered Don't Save, the next appearing only after.
    for (let sheet = 1; sheet <= 3; sheet++) {
      const wid = await waitForWindow(SAVE_PROMPT, { timeout: 20000 });
      assert.ok(wid, `save sheet ${sheet}/3 never appeared`);
      const count = await countWindows(SAVE_PROMPT);
      assert.equal(count, 1, `sheet ${sheet}/3: expected exactly 1 save prompt, saw ${count} (pre-fix: 3 concurrent)`);
      await answerNativeDialog(SAVE_PROMPT, "second");
      assert.ok(
        await waitForWindowGone(SAVE_PROMPT, { timeout: 10000 }),
        `save sheet ${sheet}/3 did not dismiss on Don't Save`,
      );
    }

    // All three sheets answered: the app exits. (Node-side only from
    // here — the wdio session dies with the app.)
    assert.ok(
      await waitForProcessGone(APP_PATTERN, { timeout: 20000 }),
      "app process still alive after all three sheets were answered",
    );
  });
});
