// D-01 — "Prism File Imported" notice dismisses (OK, and Escape).
//
// WHY wdio: the notice is an in-app React Dialog (native <dialog>), so
// WebDriver can read and click it; MCP import never surfaces the dialog
// state and cannot dismiss it. The dialog exists in-app precisely because
// the NATIVE alert it replaced was undismissable on macOS (v1.6.0 Mac
// proof: OK ignored via AX, clicks, Return/Space/Esc).
//
// PIN: the spec waits for the DOM dialog and asserts it closes on OK and
// on Escape, with the project intact and saveable afterwards. On the
// pre-fix build there IS no DOM dialog — the wait for it fails, so the
// spec fails on broken code instead of passing. (The native-alert half of
// the original bug — an undismissable native OK — is Mac device-route;
// the Linux GTK alert was dismissable, so no Linux leg is owed for it.)
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  switchToProjectWindow,
  waitForHook,
  callHook,
  projectSummary,
  isDialogOpen,
  dialogText,
  clickButton,
} from "./helpers/window.js";
import { dismissUpdateDialogIfPresent } from "./helpers/window.js";
import * as x from "./helpers/xdotool.js";
import { waitForWindowGone, typePathIntoChooser, answerNativeDialog } from "./helpers/xdotool.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SURVIVAL = path.resolve(HERE, "..", "..", "tests", "testdata", "survival.pzfx");
const COLUMN = path.resolve(HERE, "..", "..", "tests", "testdata", "column.pzfx");
const NOTICE = "Prism File Imported";
const SAVE_PROMPT = "Do you want to save the changes you made to your project?";

async function importFixture(fixture) {
  void callHook("importPrism");
  await typePathIntoChooser("Import Prism File", fixture);
  await waitForWindowGone("Import Prism File", { timeout: 10000 });
  await browser.waitUntil(async () => isDialogOpen(NOTICE), {
    timeout: 30000,
    timeoutMsg: `"${NOTICE}" dialog never appeared after importing ${fixture}`,
  });
}

describe("D-01 import notice dismisses", () => {
  before(async () => {
    await switchToProjectWindow();
    await waitForHook();
    await dismissUpdateDialogIfPresent(x);
  });

  it("OK dismisses the notice; project intact and responsive", async () => {
    await importFixture(SURVIVAL);
    const text = await dialogText(NOTICE);
    assert.match(text, /Imported 1 table from “survival”:/, "notice text wrong");
    assert.match(text, /• Three groups/, "notice lacks the table line");

    await clickButton("OK");
    await browser.waitUntil(async () => !(await isDialogOpen(NOTICE)), {
      timeout: 10000,
      timeoutMsg: "notice did not close on OK",
    });

    // Project intact: same title + table, and the app still answers.
    const summary = await projectSummary();
    assert.equal(summary.title, "survival", `title changed after dismiss: ${summary.title}`);
    assert.ok(summary.tables.some((t) => t.name === "Three groups"), "Three groups gone after dismiss");
    // Exactly one project window — the notice never orphaned a window
    // (the Quirk-2 family: a dismissed dialog leaving a lingering window).
    const handles = await browser.getWindowHandles();
    assert.equal(handles.length, 2, `expected engine + 1 project window, got ${handles.length} handles`);
  });

  it("Escape dismisses the notice on a second import", async () => {
    // Dirty project: the native save prompt precedes the import, so the
    // notice cannot appear until it is answered — trigger, answer, then
    // wait for the notice (importFixture would wait on the wrong thing).
    void callHook("importPrism");
    await typePathIntoChooser("Import Prism File", COLUMN);
    await waitForWindowGone("Import Prism File", { timeout: 10000 });
    await answerNativeDialog(SAVE_PROMPT, "second", { timeout: 20000 });
    await waitForWindowGone(SAVE_PROMPT, { timeout: 10000 });
    await browser.waitUntil(async () => isDialogOpen(NOTICE), {
      timeout: 30000,
      timeoutMsg: "notice never appeared for the second import",
    });
    const text = await dialogText(NOTICE);
    assert.match(text, /• Data 1/, "notice lacks the Data 1 line");

    // The Dialog's onCancel fires on Escape (native <dialog> behaviour).
    await browser.keys("Escape");
    await browser.waitUntil(async () => !(await isDialogOpen(NOTICE)), {
      timeout: 10000,
      timeoutMsg: "notice did not close on Escape",
    });
    const summary = await projectSummary();
    assert.equal(summary.title, "column", `title changed after Escape dismiss: ${summary.title}`);
    assert.ok(summary.tables.some((t) => t.name === "Data 1"), "Data 1 gone after dismiss");
  });
});
