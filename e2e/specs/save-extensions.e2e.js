// T-128 — extensionless save names get the format extension, in all five
// save dialogs (plus Save as .pzfx, a sixth pickSavePath caller).
//
// WHY wdio: every one of these dialogs is a NATIVE GTK chooser opened
// through pickSavePath. MCP saves take a path directly and never open a
// chooser, so the dialog behaviour — what the user typed vs what file
// lands on disk — is GUI-only. The extension rule itself
// (ensureSaveExtension) is unit-pinned in tests/; this spec pins it
// END TO END, per dialog, against the real chooser.
//
// PIN (per leg): the typed name is extensionless, so the file MUST land
// with the format extension and the extensionless path MUST NOT exist.
// If the app stopped appending (regression in ensureSaveExtension or in
// the dialog's filter handling), the extensionless file exists instead
// and the leg fails. The final leg is the discriminating pair: a name
// that ALREADY has an extension keeps it (no ".jpg.png") — a build that
// appended unconditionally would fail there, and a build that never
// appended would fail the earlier legs. No leg passes on broken code.
//
// Dialogs covered: Save Project (.hlx), Save as Prism (.prism),
// Save as .pzfx (.pzfx), converter save (.prism), graph export (.png),
// figure export (.png). The Save As Template/Method dialogs share the
// same pickSavePath and are covered by the same code path; they are not
// separate legs (their trigger is the template dialog, a different case).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
  specOutDir,
} from "./helpers/window.js";
import { dismissUpdateDialogIfPresent } from "./helpers/window.js";
import * as x from "./helpers/xdotool.js";
import { waitForWindowGone, typePathIntoChooser } from "./helpers/xdotool.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = specOutDir("save-extensions");
const SURVIVAL = path.resolve(HERE, "..", "..", "tests", "testdata", "survival.pzfx");
const NOTICE = "Prism File Imported";

// Assert the extensionless typed name landed with `ext` and nowhere else.
function assertExtended(stem, ext) {
  assert.equal(existsSync(stem), false, `extensionless file was written: ${stem}`);
  assert.ok(existsSync(`${stem}.${ext}`), `expected file missing: ${stem}.${ext}`);
}

async function saveViaChooser(title, stem) {
  await typePathIntoChooser(title, stem);
  assert.ok(await waitForWindowGone(title, { timeout: 10000 }), `chooser ${JSON.stringify(title)} did not close`);
}

describe("T-128 extensionless save names get the format extension", () => {
  let survivalTableId;
  let graphId;

  before(async () => {
    await switchToProjectWindow();
    await waitForHook();
    await dismissUpdateDialogIfPresent(x);
  });

  it("Save Project: extensionless name lands as .hlx", async () => {
    // Blank project: no prism nudge (prismOrigin is false), so Save As
    // goes straight to the chooser.
    void callHook("saveProject", true);
    await saveViaChooser("Save Project", path.join(OUT, "t128-proj"));
    assertExtended(path.join(OUT, "t128-proj"), "hlx");
  });

  it("imports survival.pzfx (data for the graph/figure legs)", async () => {
    void callHook("importPrism");
    await typePathIntoChooser("Import Prism File", SURVIVAL);
    await waitForWindowGone("Import Prism File", { timeout: 10000 });
    await browser.waitUntil(async () => isDialogOpen(NOTICE), {
      timeout: 30000,
      timeoutMsg: "import notice never appeared",
    });
    const summary = await projectSummary();
    const table = summary.tables.find((t) => t.name === "Three groups");
    assert.ok(table, `Three groups table missing after import: ${JSON.stringify(summary.tables)}`);
    survivalTableId = table.id;
    await clickButton("OK");
    await browser.waitUntil(async () => !(await isDialogOpen(NOTICE)), {
      timeout: 10000,
      timeoutMsg: "import notice did not close on OK",
    });
  });

  it("Save as Prism: extensionless name lands as .prism", async () => {
    void callHook("saveAsPrism");
    await saveViaChooser("Save as Prism", path.join(OUT, "t128-prism"));
    assertExtended(path.join(OUT, "t128-prism"), "prism");
  });

  it("Save as .pzfx: extensionless name lands as .pzfx", async () => {
    void callHook("saveAsPzfx");
    await saveViaChooser("Save as .pzfx", path.join(OUT, "t128-pzfx"));
    assertExtended(path.join(OUT, "t128-pzfx"), "pzfx");
  });

  it("Converter save: extensionless name lands as .prism", async () => {
    await callHook("openConverter");
    await browser.waitUntil(async () => isDialogOpen("Convert"), {
      timeout: 10000,
      timeoutMsg: "Convert dialog never opened",
    });
    // XPath, not wdio's `=…` text selector: the tauri driver never matches
    // bare `=`/`*=` text selectors (proven 2026-11-18 in delete-table).
    const radio = await $("//*[normalize-space()='Titer (this project) → Prism (.prism)']");
    await radio.waitForExist({ timeout: 10000 });
    await radio.click();
    const convertBtn = await $("button=Convert this project…");
    await convertBtn.waitForExist({ timeout: 10000 });
    await convertBtn.click();
    const saveBtn = await $("button=Save .prism…");
    await saveBtn.waitForExist({ timeout: 30000 });
    await saveBtn.click();
    await saveViaChooser("Save as Prism", path.join(OUT, "t128-conv"));
    assertExtended(path.join(OUT, "t128-conv"), "prism");
    // The dialog reports the saved path — the write really happened.
    const text = await dialogText("Convert");
    assert.match(text, /Saved to .*t128-conv\.prism/, `converter did not report the save: ${JSON.stringify(text.slice(0, 400))}`);
    // The Convert dialog has no "Done" button — the generic Dialog's
    // dismiss button is "Cancel" (ui/dialog.tsx). Click it inside the open
    // dialog (a bare `button=Cancel` could match another dialog's button).
    const closed = await browser.tauri.execute(() => {
      const dlg = document.querySelector("dialog[open]");
      const btn = [...(dlg?.querySelectorAll("button") ?? [])].find(
        (b) => b.textContent.trim() === "Cancel",
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    assert.ok(closed, "Convert dialog offered no Cancel button");
    await browser.waitUntil(async () => !(await isDialogOpen("Convert")), {
      timeout: 10000,
      timeoutMsg: "Convert dialog did not close on Cancel",
    });
  });

  it("Graph export: extensionless name lands as .png", async () => {
    graphId = await callHook("createGraph", survivalTableId, "xy-scatter");
    assert.equal(typeof graphId, "string", `createGraph did not return an id: ${JSON.stringify(graphId)}`);
    // The new graph becomes the active node; its Format panel holds the
    // Export section. Expand it if it starts folded. (isDisplayed, not
    // isExisting: a folded section's button exists in the DOM but cannot
    // be clicked.)
    const saveBtn = await $("button=Save…");
    if (!(await saveBtn.isDisplayed().catch(() => false))) {
      // XPath, not wdio's `=Export`: bare `=` text selectors never match
      // under the tauri driver (proven 2026-11-18 in delete-table).
      // Button only: `//*` matched 3 elements (the header button, its
      // parent div and the section div all normalize to "Export" while
      // the section is folded) and strict mode rejects that.
      const section = await $("//button[normalize-space()='Export']");
      await section.waitForExist({ timeout: 15000 });
      await section.click();
    }
    await saveBtn.waitForDisplayed({ timeout: 15000 });
    await saveBtn.click();
    await saveViaChooser("Export Graph", path.join(OUT, "t128-graph"));
    assertExtended(path.join(OUT, "t128-graph"), "png");
  });

  it("Figure export: extensionless name lands as .png", async () => {
    const figureId = await callHook("createFigure", [graphId]);
    assert.equal(typeof figureId, "string", `createFigure did not return an id: ${JSON.stringify(figureId)}`);
    // 600 DPI, not 300: DEFAULT_FIGURE_DPI is "600" (lib/figure.ts), so
    // that is the button's label on a fresh figure.
    const exportBtn = await $("button=Export Figure (600 DPI)");
    await exportBtn.waitForExist({ timeout: 15000 });
    await exportBtn.click();
    await saveViaChooser("Export Figure", path.join(OUT, "t128-fig"));
    assertExtended(path.join(OUT, "t128-fig"), "png");
  });

  it("Dotted name keeps its extension (no double extension)", async () => {
    // Back on the graph: the Export Save… writes a PNG. A name that
    // already has an extension must be left alone. The figure is active
    // now; go back to the graph through the sidebar (the graph sits under
    // its table, named after its type).
    const names = await browser.tauri.execute(() => {
      const aside = document.querySelector("aside");
      return aside ? aside.innerText.split("\n").map((s) => s.trim()).filter(Boolean) : [];
    });
    const graphName = names.find((n) => /scatter/i.test(n));
    assert.ok(graphName, `no scatter graph entry in sidebar: ${JSON.stringify(names)}`);
    // XPath, not wdio's `=…`: bare `=` text selectors never match under
    // the tauri driver (proven 2026-11-18 in delete-table).
    const entry = await $(`//span[@title='${graphName}']`);
    await entry.click();
    const saveBtn = await $("button=Save…");
    await saveBtn.waitForExist({ timeout: 15000 });
    await saveBtn.click();
    await saveViaChooser("Export Graph", path.join(OUT, "t128-dotted.jpg"));
    assert.ok(existsSync(path.join(OUT, "t128-dotted.jpg")), "dotted name was not written as-is");
    assert.equal(
      existsSync(path.join(OUT, "t128-dotted.jpg.png")),
      false,
      "extension was appended to a name that already had one",
    );
  });
});
