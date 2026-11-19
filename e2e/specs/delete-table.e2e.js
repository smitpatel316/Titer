// Q-70 — Delete Table: Ctrl+Backspace → GTK confirm → Return deletes.
//
// WHY wdio: the confirm is a NATIVE GTK dialog (confirmDelete via
// plugin-dialog `message`), so neither WebDriver nor MCP can drive it —
// MCP deletes take an id directly and never show the confirm. The delete
// itself is MCP-covered; this spec pins the confirm round-trip.
//
// PIN: the spec asserts end states — the table is gone AND Table 1 is
// untouched after Return, and the table SURVIVES after Escape (the
// negative control in the second test). A build where the confirm never
// appeared would fail the dialog wait; a build where Escape deleted would
// fail the survival assertion; a build where Return did not delete would
// fail the gone assertion.
//
// FOCUS NOTE (from the menu action): with the grid input focused,
// Ctrl+Backspace clears cells instead of deleting the table. The spec
// clicks "Table 2" in the sidebar first so focus is off the grid, and
// asserts that precondition before pressing the keys.
import assert from "node:assert/strict";
import {
  switchToProjectWindow,
  waitForHook,
  projectSummary,
} from "./helpers/window.js";
import { dismissUpdateDialogIfPresent } from "./helpers/window.js";
import * as x from "./helpers/xdotool.js";
import { sleep, waitForWindow, waitForWindowGone } from "./helpers/xdotool.js";

const DELETE_TITLE = "Delete “Table 2”?";

async function createTable2() {
  await x.key("ctrl+alt+t");
  // The dialog takes a moment to map: querying its buttons immediately
  // after the keypress races React's render (lost once, 2026-11-18).
  await browser.waitUntil(
    async () => browser.tauri.execute(() => !!document.querySelector("dialog[open]")),
    { timeout: 10000, timeoutMsg: "New Table dialog never opened" },
  );
  // Click "Column" INSIDE the open New Table dialog. A bare `=Column`
  // text match is ambiguous — the grid's own column header is also
  // "Column" — so find the button in the open <dialog> and click it.
  const clicked = await browser.tauri.execute(() => {
    const dlg = document.querySelector("dialog[open]");
    const btn = [...(dlg?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent.trim() === "Column",
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  assert.ok(clicked, "New Table dialog did not offer a Column option");
  await browser.waitUntil(
    async () => (await projectSummary()).tables.some((t) => t.name === "Table 2"),
    { timeout: 10000, timeoutMsg: "Table 2 was not created" },
  );
}

async function focusTable2InSidebar() {
  // XPath, not wdio's `=Table 2` text selector: the tauri driver never
  // matches bare `=`/`*=` text selectors (proven 2026-11-18: the span
  // <span class="truncate" title="Table 2">Table 2</span> is in the DOM
  // and visible, `=Table 2` returns isExisting=false, the XPath matches).
  // `button=` selectors DO work under this driver (import-picker is green).
  const row = await $("//span[@title='Table 2']");
  await row.waitForExist({ timeout: 10000 });
  await row.click();
  await sleep(400);
  const activeLabel = await browser.tauri.execute(
    () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName ?? "",
  );
  assert.ok(
    !/row \d+/.test(activeLabel),
    `grid input still focused before Delete (activeElement ${activeLabel}) — Ctrl+Backspace would clear cells, not delete`,
  );
}

describe("Q-70 Delete Table confirm", () => {
  before(async () => {
    await switchToProjectWindow();
    await waitForHook();
    await dismissUpdateDialogIfPresent(x);
  });

  it("Return on the confirm deletes Table 2, Table 1 untouched", async () => {
    await createTable2();
    await focusTable2InSidebar();
    await x.key("ctrl+BackSpace");
    const wid = await waitForWindow(DELETE_TITLE, { timeout: 15000 });
    assert.ok(wid, `Delete confirm ${JSON.stringify(DELETE_TITLE)} never appeared`);
    await x.activateWindow(wid);
    await sleep(400);
    await x.key("Return");
    assert.ok(
      await waitForWindowGone(DELETE_TITLE, { timeout: 10000 }),
      "Delete confirm did not dismiss on Return",
    );
    const summary = await projectSummary();
    assert.deepEqual(
      summary.tables.map((t) => t.name),
      ["Table 1"],
      `expected only Table 1 after delete, got ${JSON.stringify(summary.tables)}`,
    );
  });

  it("Escape on the confirm leaves Table 2 in place (negative control)", async () => {
    await createTable2();
    await focusTable2InSidebar();
    await x.key("ctrl+BackSpace");
    const wid = await waitForWindow(DELETE_TITLE, { timeout: 15000 });
    assert.ok(wid, `Delete confirm ${JSON.stringify(DELETE_TITLE)} never appeared (second run)`);
    await x.activateWindow(wid);
    await sleep(400);
    await x.key("Escape");
    assert.ok(
      await waitForWindowGone(DELETE_TITLE, { timeout: 10000 }),
      "Delete confirm did not dismiss on Escape",
    );
    const summary = await projectSummary();
    assert.ok(
      summary.tables.some((t) => t.name === "Table 2"),
      `Table 2 was deleted despite Escape: ${JSON.stringify(summary.tables)}`,
    );
    assert.ok(summary.tables.some((t) => t.name === "Table 1"), "Table 1 missing after cancelled delete");
  });
});
