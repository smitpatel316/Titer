// Q-53 + Q-54 — Prism import picker (GTK chooser) + cancel path.
//
// WHY wdio: the picker is a NATIVE GTK chooser (Rust `choose_prism_file`,
// non-blocking, path returned via the "prism-file-picked" event). MCP
// imports take a path directly and never open the picker, so the open /
// path-return / cancel behaviour is GUI-only. The import itself (parse +
// tables) is MCP-covered; this spec pins the chooser round-trip and the
// notice that follows it.
//
// PIN: Q-54 — Escape must close the chooser with no import (a chooser that
// stayed open, or an import that ran anyway, fails the assertions).
// Q-53 — the spec asserts end states only a completed import produces:
// window retitled to the file, the named table in the sidebar, and the
// in-app "Prism File Imported" notice with its exact report lines. A build
// where the picker never returns a path (the Nov 8 deadlock class) leaves
// the project Untitled and fails here; a build where the notice never
// appears fails the dialog wait.
//
// NOTE on the second import: the project is dirty after the first import,
// so the native Save / Don't Save / Cancel prompt appears first
// (confirmDiscard). The spec answers "Don't Save" by keyboard (Tab moves
// to the second button, Space activates it — the buttons are laid out in
// the order Save / Don't Save / Cancel) and verifies the import ran; a
// wrong button would open the save chooser or abort the import, and the
// outcome assertions catch either.
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
import { sleep, waitForWindow, waitForWindowGone, typePathIntoChooser, answerNativeDialog } from "./helpers/xdotool.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SURVIVAL = path.resolve(HERE, "..", "..", "tests", "testdata", "survival.pzfx");
const COLUMN = path.resolve(HERE, "..", "..", "tests", "testdata", "column.pzfx");
const NOTICE = "Prism File Imported";
const SAVE_PROMPT = "Do you want to save the changes you made to your project?";

async function waitForNotice(timeout = 30000) {
  await browser.waitUntil(async () => isDialogOpen(NOTICE), {
    timeout,
    timeoutMsg: `"${NOTICE}" in-app dialog never appeared after import`,
  });
}

describe("Q-53/Q-54 Prism import picker", () => {
  before(async () => {
    await switchToProjectWindow();
    await waitForHook();
    await dismissUpdateDialogIfPresent(x);
  });

  it("Q-54: Escape cancels the picker, no import, UI responsive", async () => {
    void callHook("importPrism");
    const wid = await waitForWindow("Import Prism File", { timeout: 20000 });
    assert.ok(wid, "Import Prism File chooser never opened");
    await x.activateWindow(wid);
    await sleep(400);
    await x.key("Escape");
    assert.ok(
      await waitForWindowGone("Import Prism File", { timeout: 10000 }),
      "chooser did not close on Escape",
    );
    const summary = await projectSummary();
    assert.equal(summary.title, "Untitled", `import ran despite cancel (title ${summary.title})`);
    assert.deepEqual(
      summary.tables.map((t) => t.name),
      ["Table 1"],
      "tables changed after a cancelled pick",
    );
    assert.equal(await isDialogOpen(NOTICE), false, "import notice appeared after a cancelled pick");
  });

  it("Q-53: survival.pzfx imports — retitle, table, notice", async () => {
    void callHook("importPrism");
    await typePathIntoChooser("Import Prism File", SURVIVAL);
    assert.ok(
      await waitForWindowGone("Import Prism File", { timeout: 10000 }),
      "chooser did not close after picking survival.pzfx",
    );
    await waitForNotice();
    const text = await dialogText(NOTICE);
    assert.match(text, /Imported 1 table from “survival”:/, `notice lacks the import line: ${JSON.stringify(text)}`);
    assert.match(text, /• Three groups/, `notice lacks the table line: ${JSON.stringify(text)}`);
    assert.match(text, /Save the project to keep it as a Titer project\./, "notice lacks the save line");

    const summary = await projectSummary();
    assert.equal(summary.title, "survival", `window not retitled (title ${summary.title})`);
    assert.ok(
      summary.tables.some((t) => t.name === "Three groups"),
      `Three groups table missing: ${JSON.stringify(summary.tables)}`,
    );
    // Dismissal itself is D-01's case (import-notice.e2e.js); here OK is
    // just cleanup so the next import starts from a clean state.
    await clickButton("OK");
    await browser.waitUntil(async () => !(await isDialogOpen(NOTICE)), {
      timeout: 10000,
      timeoutMsg: "import notice did not close on OK",
    });
  });

  it("Q-53: second import (column.pzfx) — Don't Save, then notice", async () => {
    void callHook("importPrism");
    await typePathIntoChooser("Import Prism File", COLUMN);
    assert.ok(
      await waitForWindowGone("Import Prism File", { timeout: 10000 }),
      "chooser did not close after picking column.pzfx",
    );
    // The project is dirty from the survival import, so the native save
    // prompt appears before the import runs.
    await answerNativeDialog(SAVE_PROMPT, "second", { timeout: 20000 });
    assert.ok(
      await waitForWindowGone(SAVE_PROMPT, { timeout: 10000 }),
      "save prompt did not dismiss on Don't Save",
    );
    await waitForNotice();
    const text = await dialogText(NOTICE);
    assert.match(text, /Imported 1 table from “column”:/, `notice lacks the import line: ${JSON.stringify(text)}`);
    assert.match(text, /• Data 1/, `notice lacks the table line: ${JSON.stringify(text)}`);

    const summary = await projectSummary();
    assert.equal(summary.title, "column", `window not retitled (title ${summary.title})`);
    assert.ok(
      summary.tables.some((t) => t.name === "Data 1"),
      `Data 1 table missing: ${JSON.stringify(summary.tables)}`,
    );
    await clickButton("OK");
    await browser.waitUntil(async () => !(await isDialogOpen(NOTICE)), {
      timeout: 10000,
      timeoutMsg: "import notice did not close on OK",
    });
  });
});
