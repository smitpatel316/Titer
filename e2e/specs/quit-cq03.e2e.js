// CQ-03 — quit flow: Save writes the file, quit continues.
//
// WHY wdio: the save prompt AND the save chooser are both native
// (plugin-dialog `message` + `save`); MCP close skips the prompt and MCP
// save takes a path directly, so neither half is MCP-reachable.
//
// PIN: the file MUST exist on disk, be valid project JSON, and carry the
// typed value — a build where Save did not write (or wrote elsewhere)
// fails the file assertions. The quit MUST then continue to a clean exit
// (process gone): a build where the quit stalled after saving fails the
// final wait. The extensionless typed name also re-pins T-128's rule
// here (file lands as .hlx).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  switchToProjectWindow,
  waitForHook,
  specOutDir,
} from "./helpers/window.js";
import { dismissUpdateDialogIfPresent } from "./helpers/window.js";
import * as x from "./helpers/xdotool.js";
import {
  waitForWindow,
  waitForWindowGone,
  answerNativeDialog,
  typePathIntoChooser,
  waitForProcessGone,
} from "./helpers/xdotool.js";
import { SAVE_PROMPT, APP_PATTERN, dirtyCurrentWindow } from "./helpers/quit.js";

const OUT = specOutDir("quit-cq03");
const STEM = path.join(OUT, "cq03-save");
const WITH_EXT = `${STEM}.hlx`;

describe("CQ-03 Save on quit writes the file, quit continues", () => {
  before(async () => {
    await switchToProjectWindow();
    await waitForHook();
    await dismissUpdateDialogIfPresent(x);
  });

  it("Save writes the file and the quit completes", async () => {
    await dirtyCurrentWindow("4242");
    await x.key("ctrl+q");
    const wid = await waitForWindow(SAVE_PROMPT, { timeout: 20000 });
    assert.ok(wid, "save prompt never appeared on quit");
    // First button is Save (focused by default): Space activates it.
    await answerNativeDialog(SAVE_PROMPT, "first");
    assert.ok(
      await waitForWindowGone(SAVE_PROMPT, { timeout: 10000 }),
      "save prompt did not dismiss on Save",
    );

    // Untitled, so Save opens the Save Project chooser.
    await typePathIntoChooser("Save Project", STEM);
    assert.ok(
      await waitForWindowGone("Save Project", { timeout: 10000 }),
      "Save Project chooser did not close",
    );

    assert.equal(existsSync(STEM), false, `extensionless file was written: ${STEM}`);
    assert.ok(existsSync(WITH_EXT), `expected saved file missing: ${WITH_EXT}`);
    const parsed = JSON.parse(readFileSync(WITH_EXT, "utf8"));
    assert.equal(parsed.schemaVersion, 1, `saved file schemaVersion is ${parsed.schemaVersion}`);
    assert.ok(readFileSync(WITH_EXT, "utf8").includes("4242"), "saved file lacks the typed value");

    // The quit continues past the save to a clean exit. (Node-side only
    // from here — the wdio session dies with the app.)
    assert.ok(
      await waitForProcessGone(APP_PATTERN, { timeout: 20000 }),
      "app process still alive after Save on quit",
    );
  });
});
