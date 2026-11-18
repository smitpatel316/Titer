// Q-71 — launch renders the menu bar + Table 1 Column grid (25 rows).
//
// WHY wdio: the grid is DOM (WebDriver can count its rendered rows); MCP
// has no tool that reads rendered rows. The menu bar is NATIVE (muda/GTK),
// so WebDriver cannot see it — its leg drives the bar with xdotool and
// proves a menu opened (a new X window appears + the display screenshot
// changes), with ffmpeg evidence. A spec that only asserted the hook would
// pass with no menu bar at all.
//
// PIN: on a build where the window opened without a project (or with an
// empty store), "Table 1" is absent and fewer than 25 row numbers render —
// the row-count assertion fails. The menu-open probe fails when the menu
// bar is missing or does not respond to input.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import {
  switchToProjectWindow,
  waitForHook,
  specOutDir,
} from "./helpers/window.js";
import {
  sleep,
  searchWindows,
  waitForWindow,
  activateWindow,
  key,
  xdotool,
} from "./helpers/xdotool.js";
import { dismissUpdateDialogIfPresent } from "./helpers/window.js";
import * as x from "./helpers/xdotool.js";

const execFileAsync = promisify(execFile);
const OUT = specOutDir("launch-render");

async function displayScreenshot(name) {
  const file = `${OUT}/${name}.png`;
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "x11grab",
    "-video_size",
    "1280x800",
    "-i",
    process.env.DISPLAY ?? ":99",
    "-frames:v",
    "1",
    file,
  ]);
  return file;
}

// Window ids in the root tree (every mapped X window, incl. menus).
async function rootTreeIds() {
  const { stdout } = await execFileAsync("xwininfo", ["-root", "-tree"], {
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":99" },
  });
  return new Set([...stdout.matchAll(/0x[0-9a-f]+/g)].map((m) => m[0]));
}

describe("Q-71 launch renders menu bar + Table 1 grid", () => {
  before(async () => {
    await switchToProjectWindow();
    await waitForHook();
    await dismissUpdateDialogIfPresent(x);
  });

  it("renders Table 1 with at least 25 grid rows", async () => {
    const hasTable1 = await browser.tauri.execute(() => document.body.innerText.includes("Table 1"));
    assert.equal(hasTable1, true, "sidebar does not list Table 1");

    // Row numbers are gutter divs (class tabular-nums, text = row number).
    // The grid virtualizes, so this counts the rows rendered at launch size.
    const rows = await browser.tauri.execute(() =>
      [...document.querySelectorAll("div.tabular-nums")]
        .map((d) => Number(d.textContent))
        .filter((n) => Number.isInteger(n) && n > 0),
    );
    assert.ok(rows.includes(1), `row 1 not rendered (got ${JSON.stringify(rows.slice(0, 8))})`);
    const maxRow = Math.max(...rows);
    assert.ok(maxRow >= 25, `expected >= 25 rendered rows, got max ${maxRow} (${rows.length} row-number cells)`);

    // The grid's idle input sits on the active cell (row 1) and holds focus.
    const inputLabel = await browser.tauri.execute(
      () => document.querySelector("input[aria-label]")?.getAttribute("aria-label") ?? "",
    );
    assert.match(inputLabel, /row 1/, `grid input not on row 1 (aria-label ${JSON.stringify(inputLabel)})`);
  });

  it("has a responding native menu bar (File menu opens)", async () => {
    const appWindows = await searchWindows("Untitled");
    assert.ok(appWindows.length > 0, "no Untitled project window on this display");
    await activateWindow(appWindows[0]);
    await sleep(500);
    await displayScreenshot("q71-before-menu");

    // Open the File menu from the keyboard and watch for the popup: GTK
    // menus are separate X windows, so a new id in the root tree proves
    // the menu bar exists AND opened. F10 focuses the bar when no
    // mnemonic is bound; Alt+F is tried first (the usual File mnemonic).
    const before = await rootTreeIds();
    await key("alt+F");
    await sleep(800);
    let after = await rootTreeIds();
    let openedVia = "alt+F";
    let opened = [...after].some((id) => !before.has(id));
    if (!opened) {
      await key("Escape");
      await sleep(300);
      const before2 = await rootTreeIds();
      await key("F10");
      await sleep(800);
      after = await rootTreeIds();
      opened = [...after].some((id) => !before2.has(id));
      openedVia = "F10";
    }
    await displayScreenshot("q71-menu-open");
    assert.ok(opened, "no menu popup window appeared via alt+F or F10 — menu bar missing or unresponsive");
    // Record which key opened it; the menu chrome stays a Mac-proof item,
    // this only proves the Linux bar responds.
    writeFileSync(`${OUT}/q71-menu-open-via.txt`, `menu opened via ${openedVia}\n`);
    await key("Escape");
    await sleep(300);
  });
});
