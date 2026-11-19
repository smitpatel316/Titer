// Q-66 — Save: GTK Save chooser appends .hlx to a typed name; reopen restores.
//
// WHY wdio: the chooser is a NATIVE GTK dialog (plugin-dialog `save`,
// `pickSavePath`), so neither WebDriver nor MCP can drive it — MCP saves
// take a path directly. The round-trip half (reopen restores values) IS
// MCP-covered (roundtrip_hlx_demo); this spec pins the chooser half plus
// a GUI-driven reopen, so the two legs together prove the whole flow.
//
// PIN: the typed name is extensionless ("q66-proj"). The file MUST land
// as "q66-proj.hlx" (GTK appends the filter extension, and
// ensureSaveExtension appends it in code) and the extensionless path MUST
// NOT exist. If neither appended (regression in either place), the
// extensionless file exists instead and both assertions fail. The reopen
// leg asserts the saved values come back — a file that was never written,
// or written empty, fails there.
//
// NOTE: QA's original row ("Ctrl+O Recent restores 4 tables / 10 analyses
// / graph") described that session's project, not a reproducible fixture;
// the reopen leg here uses this spec's own typed values instead.
import assert from "node:assert/strict";
import { existsSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  switchToProjectWindow,
  waitForHook,
  projectSummary,
  specOutDir,
  switchToHandle,
  projectWindowHandles,
} from "./helpers/window.js";
import { dismissUpdateDialogIfPresent } from "./helpers/window.js";
import * as x from "./helpers/xdotool.js";
import { waitForWindow, waitForWindowGone, typePathIntoChooser } from "./helpers/xdotool.js";
import { typeColumnAValues, pageTextContains } from "./helpers/grid.js";

const OUT = specOutDir("save-chooser");
const NAME = path.join(OUT, "q66-proj");
const WITH_EXT = `${NAME}.hlx`;
const COPY = path.join(OUT, "q66-proj-copy.hlx");
const VALUES = ["101", "202", "303"];

describe("Q-66 Save chooser appends .hlx", () => {
  before(async () => {
    // Start clean: a leftover q66-proj.hlx from a previous run makes the
    // Save chooser stop on GTK's overwrite confirmation instead of closing.
    rmSync(WITH_EXT, { force: true });
    rmSync(COPY, { force: true });
    rmSync(NAME, { force: true });
    await switchToProjectWindow();
    await waitForHook();
    await dismissUpdateDialogIfPresent(x);
  });

  it("types values, saves extensionless, file lands as .hlx", async () => {
    await typeColumnAValues(VALUES);
    assert.ok(await pageTextContains(...VALUES), `typed values not rendered: ${VALUES.join(",")}`);
    const before = await projectSummary();
    assert.equal(before.isDirty, true, "project not dirty after typing (save would be a no-op)");

    // Ctrl+S is the menu accelerator for File > Save.
    await x.key("ctrl+s");
    await typePathIntoChooser("Save Project", NAME);
    assert.ok(
      await waitForWindowGone("Save Project", { timeout: 10000 }),
      "Save Project chooser did not close",
    );

    assert.equal(existsSync(NAME), false, `extensionless file was written: ${NAME}`);
    assert.ok(existsSync(WITH_EXT), `expected saved file missing: ${WITH_EXT}`);
    const parsed = JSON.parse(readFileSync(WITH_EXT, "utf8"));
    assert.equal(parsed.schemaVersion, 1, `saved file schemaVersion is ${parsed.schemaVersion}`);
    const raw = readFileSync(WITH_EXT, "utf8");
    for (const v of VALUES) assert.ok(raw.includes(v), `saved file lacks typed value ${v}`);

    const after = await projectSummary();
    assert.equal(after.isDirty, false, "project still dirty after save");
    assert.equal(after.title, "q66-proj", `window not retitled to the saved name: ${after.title}`);
  });

  it("reopens the saved file with its values (Ctrl+O chooser)", async () => {
    // Reopen a COPY: opening the same path that's already open just brings
    // its window forward (open() in main.rs, by design — no second window).
    copyFileSync(WITH_EXT, COPY);
    const beforeHandles = await projectWindowHandles();
    await x.key("ctrl+o");
    await typePathIntoChooser("Open Project", COPY);
    assert.ok(await waitForWindowGone("Open Project", { timeout: 10000 }), "Open Project chooser did not close");

    // Open lands in a new window (the current one is not blank). The new
    // window takes a moment to register with the driver — a single probe
    // right after the chooser closes still sees 1 (proven 2026-11-18:
    // handles were [project-1] ~0.6 s after Return, [project-1, project-2]
    // ~2 s later) — so poll instead of asserting once.
    let handles;
    await browser.waitUntil(
      async () => {
        handles = await projectWindowHandles();
        return handles.length >= 2;
      },
      { timeout: 15000, timeoutMsg: "expected a second project window after open" },
    );
    // The reopened window is the new handle. (Its document.title is the
    // project's stored name, "q66-proj", not the copy's filename — title
    // alone can't tell the two windows apart.)
    const opened = handles.find((h) => !beforeHandles.includes(h));
    assert.ok(opened, "no new window handle after reopen");
    await switchToHandle(opened);
    assert.ok(await pageTextContains(...VALUES), `reopened project lacks typed values: ${VALUES.join(",")}`);
    const summary = await projectSummary();
    assert.ok(summary.tables.some((t) => t.name === "Table 1"), "Table 1 missing after reopen");
  });
});
