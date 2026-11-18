// CQ-02 — quit flow: Cancel aborts the quit cleanly.
//
// WHY wdio: same native save prompt as CQ-01 (see that file) — MCP close
// skips the prompt by design, so only the GUI path exercises it.
//
// PIN: after Cancel the app must be alive, all windows present, and the
// project responsive. A build where Cancel still quit (or left the window
// half-closed) fails the liveness assertions below. Unlike CQ-01/03/04,
// the session SURVIVES here, so the spec can assert through the hook.
import assert from "node:assert/strict";
import {
  switchToProjectWindow,
  waitForHook,
  projectSummary,
} from "./helpers/window.js";
import { dismissUpdateDialogIfPresent } from "./helpers/window.js";
import * as x from "./helpers/xdotool.js";
import {
  sleep,
  waitForWindow,
  waitForWindowGone,
  searchWindows,
  pidsFor,
  answerNativeDialog,
} from "./helpers/xdotool.js";
import { SAVE_PROMPT, APP_PATTERN, dirtyCurrentWindow } from "./helpers/quit.js";

describe("CQ-02 Cancel aborts the quit", () => {
  before(async () => {
    await switchToProjectWindow();
    await waitForHook();
    await dismissUpdateDialogIfPresent(x);
  });

  it("Cancel aborts the quit: app alive, window present, project intact", async () => {
    await dirtyCurrentWindow();
    await x.key("ctrl+q");
    const wid = await waitForWindow(SAVE_PROMPT, { timeout: 20000 });
    assert.ok(wid, "save prompt never appeared on quit");
    await answerNativeDialog(SAVE_PROMPT, "escape");
    assert.ok(
      await waitForWindowGone(SAVE_PROMPT, { timeout: 10000 }),
      "save prompt did not dismiss on Cancel",
    );

    // The quit was aborted: process alive, window still there, project
    // still dirty and responsive.
    assert.ok((await pidsFor(APP_PATTERN)).length > 0, "app process died despite Cancel");
    assert.ok((await searchWindows("Untitled")).length > 0, "project window gone despite Cancel");
    const summary = await projectSummary();
    assert.equal(summary.title, "Untitled", `title changed after Cancel: ${summary.title}`);
    assert.equal(summary.isDirty, true, "dirty flag lost after Cancel");
    await sleep(2000);
    assert.ok((await pidsFor(APP_PATTERN)).length > 0, "app process died within 2s after Cancel");
  });
});
