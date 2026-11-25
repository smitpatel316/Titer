// Shared macOS driver for the wdio lane (check/e2e-conversion) — the
// AppleScript/JXA counterpart of e2e/specs/helpers/xdotool.js.
//
// WHY a second driver: xdotool is Linux-only, and the Mac device route is
// the only way to drive what lives OUTSIDE the webview on macOS — the
// native menu bar (real NSMenus; on macOS the app-menu items WORK, unlike
// Linux where the predefined Quit/Services items are disabled), the native
// save/open panels (NSSavePanel/NSOpenPanel, shown as sheets), and the
// NSAlert sheets (Save / Don't Save / Cancel, Delete, update prompt).
// WebDriver cannot see any of these; MCP cannot reach them either (MCP
// tools take paths directly and never open a picker).
//
// The public surface mirrors xdotool.js one-for-one (same names, same
// shapes) so a spec swaps drivers by changing one import, plus the
// Mac-only menu ops xdotool cannot express (clickMenuItem, clickMenuPath,
// menuItems, menuItemEnabled) and closeWindow.
//
// HOW IT WORKS: every live operation is one `osascript -l JavaScript`
// (JXA) invocation — JXA manipulates strings and JSON far more sanely
// than AppleScript, and the script is written to a temp file (never
// `-e`, which breaks on quotes) under $MAC_DRIVER_TMPDIR or a
// `.mac-driver-tmp` scratch dir in the cwd (never /tmp — repo rule),
// then deleted. Every wait retries on a poll loop: AX probes lie under
// load and sheets take a moment to attach — never conclude from a single
// probe.
//
// PROVEN MAC LESSONS baked in (do not "simplify" these away):
// - A menu must be opened AND its leaf clicked in ONE osascript call —
//   the menu closes between calls, so a two-call driver can never click
//   anything. buildMenuPathScript emits a single script that clicks the
//   menu bar item, each intermediate item, then the leaf.
// - Native dialogs are usually SHEETS attached to a project window, not
//   standalone windows (main.rs: two save sheets attached, a third once
//   came up standalone and dead to input). searchWindows therefore scans
//   sheets too, matching on the sheet's first static text (the alert
//   title), and a `wid` is "window:<n>" or "sheet:<win>:<sheet>".
// - Dialog answers click by BUTTON TITLE, not by position: NSAlert
//   buttons enumerate left-to-right with the default action rightmost,
//   so a positional "first" would hit Don't Save instead of Save.
//   dialogButtonTitle maps the app's known dialogs; unknown dialogs fall
//   back to positional (the caller MUST verify the outcome, same as
//   xdotool's Tab-counting contract).
// - osascript keystroke does NOT reach the WKWebView from an SSH session
//   (CG mouse events do). The wdio runner runs ON the Mac, where System
//   Events keystroke reaches the frontmost app — this driver is for that
//   runner, not for SSH driving. Menu clicks and AX reads DO work over
//   SSH; keystrokes do not.
// - cliclick (raw CG mouse clicks, `brew install cliclick`) is the
//   fallback for clickDialogButtonAt when no AX button sits near the
//   target point; the AX nearest-button click is tried first.
//
// LIVE-MAC STATUS: this lane is build-first — the driver is written and
// pinned on Linux, but no live Mac run has exercised it yet (the Mac slot
// belongs to proof batch #3 while this lane lands). The owed live pass:
// run e2e/specs/mac-driver.e2e.js under wdio on the Mac, then convert
// the quit/save/update specs to import this driver instead of xdotool.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

/** Process name of the app as System Events sees it. */
export const APP_NAME = process.env.TITER_APP_NAME ?? "Titer";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requireMac() {
  if (process.platform !== "darwin") {
    throw new Error(
      `mac-driver runs on macOS only (this is ${process.platform}); the script builders are platform-independent and unit-tested, the live functions are not`,
    );
  }
}

// ── Pure script builders (unit-tested by the mac-e2e-driver pin) ─────────

// macOS virtual key codes (CGKeyCode) for the keys the specs send.
const KEY_CODES = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9,
  b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28, "9": 25, "0": 29,
  u: 32, i: 34, o: 31, p: 35, l: 37, j: 38, k: 40, n: 45, m: 46,
};
const NAMED_KEYS = {
  return: 36, enter: 36, tab: 48, space: 49, escape: 53, esc: 53,
  delete: 51, backspace: 51, up: 126, down: 125, left: 123, right: 124,
  home: 115, end: 119, pageup: 116, pagedown: 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
};

/**
 * Translate an xdotool-style key ("ctrl+n", "Return", "Tab", "space",
 * "Escape", "ctrl+shift+g") to a JXA System Events `keyCode(...)` call.
 * Ctrl on Linux is Cmd on macOS — the specs' ctrl+n / ctrl+s / ctrl+q
 * are the app's Cmd+N / Cmd+S / Cmd+Q accelerators there.
 */
export function translateKey(keys) {
  const parts = String(keys).split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
  const mods = [];
  let base = null;
  for (const p of parts) {
    if (p === "ctrl" || p === "control" || p === "cmd" || p === "meta" || p === "super") mods.push("command down");
    else if (p === "shift") mods.push("shift down");
    else if (p === "alt" || p === "option") mods.push("option down");
    else if (base === null) base = p;
    else throw new Error(`mac-driver: cannot translate key ${JSON.stringify(keys)}`);
  }
  if (base === null) throw new Error(`mac-driver: no key in ${JSON.stringify(keys)}`);
  const code = base.length === 1 ? KEY_CODES[base] : NAMED_KEYS[base];
  if (code === undefined) throw new Error(`mac-driver: unknown key ${JSON.stringify(base)}`);
  const using = mods.length > 0 ? `, {using: [${mods.map((m) => `"${m}"`).join(", ")}]}` : "";
  return `keyCode(${code}${using})`;
}

/** JXA that activates the app, then sends one translated key. */
export function buildKeyScript(app, keys) {
  return [
    `Application(${JSON.stringify(app)}).activate();`,
    `delay(0.3);`,
    `var se = Application("System Events");`,
    `se.${translateKey(keys)};`,
  ].join("\n");
}

/** JXA that activates the app, then types text via System Events. */
export function buildTypeScript(app, text) {
  return [
    `Application(${JSON.stringify(app)}).activate();`,
    `delay(0.3);`,
    `var se = Application("System Events");`,
    `se.keystroke(${JSON.stringify(text)});`,
  ].join("\n");
}

/**
 * JXA for the Go-to-Folder leg of a native file panel: Cmd+Shift+G opens
 * the location sheet, the full path is typed, Return confirms. In a save
 * panel this sets folder AND filename; in an open panel it opens the
 * file. The caller checks whether the panel is still up afterwards —
 * a save panel needs a second Return to confirm, an open panel does not.
 */
export function buildGoToFolderScript(filePath) {
  return [
    `var se = Application("System Events");`,
    `se.keyCode(5, {using: ["command down", "shift down"]});`,
    `delay(0.5);`,
    `se.keystroke(${JSON.stringify(filePath)});`,
    `delay(0.3);`,
    `se.keyCode(36);`,
  ].join("\n");
}

/** JXA that lists every window and sheet of the app as JSON. */
export function buildListWindowsScript(app) {
  return [
    `var out = [];`,
    `try {`,
    `  var se = Application("System Events");`,
    `  var proc = se.processes.byName(${JSON.stringify(app)});`,
    `  var wins = proc.windows();`,
    `  for (var i = 0; i < wins.length; i++) {`,
    `    var w = wins[i];`,
    `    var name = "";`,
    `    try { name = w.name(); } catch (e) {}`,
    `    out.push({ kind: "window", wid: "window:" + (i + 1), title: name, windowIndex: i + 1, sheetIndex: 0 });`,
    `    var sheets = [];`,
    `    try { sheets = w.sheets(); } catch (e) {}`,
    `    for (var j = 0; j < sheets.length; j++) {`,
    `      var s = sheets[j];`,
    `      var title = "";`,
    `      try { var sts = s.staticTexts(); if (sts.length > 0) title = sts[0].value(); } catch (e) {}`,
    `      out.push({ kind: "sheet", wid: "sheet:" + (i + 1) + ":" + (j + 1), title: title, windowIndex: i + 1, sheetIndex: j + 1 });`,
    `    }`,
    `  }`,
    `} catch (e) {}`,
    `JSON.stringify(out);`,
  ].join("\n");
}

/**
 * JXA that opens a menu path and clicks its leaf in ONE invocation.
 * path[0] is the menu bar item, path[path.length - 1] the leaf; every
 * segment between is a menu item whose submenu holds the next segment.
 * Single-script by necessity: the menu closes between osascript calls.
 */
export function buildMenuPathScript(app, path) {
  if (!Array.isArray(path) || path.length < 2) {
    throw new Error("mac-driver: menu path needs at least [menu, item]");
  }
  const lines = [
    `var se = Application("System Events");`,
    `var proc = se.processes.byName(${JSON.stringify(app)});`,
    `var bar = proc.menuBars[0].menuBarItems.byName(${JSON.stringify(path[0])});`,
    `bar.click();`,
  ];
  let expr = `bar.menus[0]`;
  for (let i = 1; i < path.length - 1; i++) {
    lines.push(`var mid${i} = ${expr}.menuItems.byName(${JSON.stringify(path[i])});`);
    lines.push(`mid${i}.click();`);
    expr = `mid${i}.menus[0]`;
  }
  lines.push(`${expr}.menuItems.byName(${JSON.stringify(path[path.length - 1])}).click();`);
  return lines.join("\n");
}

/** JXA that lists one menu's items as JSON [{title, enabled}]. */
export function buildMenuItemsScript(app, menu) {
  return [
    `var out = [];`,
    `try {`,
    `  var se = Application("System Events");`,
    `  var proc = se.processes.byName(${JSON.stringify(app)});`,
    `  var items = proc.menuBars[0].menuBarItems.byName(${JSON.stringify(menu)}).menus[0].menuItems();`,
    `  for (var i = 0; i < items.length; i++) {`,
    `    var title = ""; var enabled = false;`,
    `    try { title = items[i].title(); } catch (e) {}`,
    `    try { enabled = items[i].enabled(); } catch (e) {}`,
    `    out.push({ title: title, enabled: enabled });`,
    `  }`,
    `} catch (e) {}`,
    `JSON.stringify(out);`,
  ].join("\n");
}

/** JXA that reports whether one menu item is enabled (JSON true/false). */
export function buildMenuItemEnabledScript(app, menu, item) {
  return [
    `var enabled = false;`,
    `try {`,
    `  var se = Application("System Events");`,
    `  var proc = se.processes.byName(${JSON.stringify(app)});`,
    `  enabled = proc.menuBars[0].menuBarItems.byName(${JSON.stringify(menu)}).menus[0].menuItems.byName(${JSON.stringify(item)}).enabled();`,
    `} catch (e) {}`,
    `JSON.stringify(!!enabled);`,
  ].join("\n");
}

// The app's native dialogs (src/native.ts) and their button titles, in
// the order the specs' "first/second/third" choices mean. Unknown
// dialogs return null and answerNativeDialog falls back to position.
const DIALOG_BUTTONS = [
  [/^Do you want to save the changes you made to your project\?$/, ["Save", "Don't Save", "Cancel"]],
  [/^Delete /, ["Delete", "Cancel"]],
  [/^Titer .* is available$/, ["Update Now", "Later"]],
  [/^Couldn't Install the Update$/, ["Retry", "Quit"]],
];

/** Button title for a dialog + choice, or null when the dialog is unknown. */
export function dialogButtonTitle(title, choice) {
  const idx = { first: 0, second: 1, third: 2 }[choice];
  if (idx === undefined) return null;
  for (const [re, buttons] of DIALOG_BUTTONS) {
    if (re.test(title)) return buttons[idx] ?? null;
  }
  return null;
}

// JXA fragment (shared by the answer/click builders) that finds a dialog
// — a window whose name contains the title, or a sheet whose first static
// text does — and binds it to `found.el`.
function findDialogFragment(app, title) {
  return [
    `var se = Application("System Events");`,
    `var proc = se.processes.byName(${JSON.stringify(app)});`,
    `var found = null;`,
    `var wins = proc.windows();`,
    `for (var i = 0; i < wins.length && !found; i++) {`,
    `  var w = wins[i];`,
    `  var name = ""; try { name = w.name(); } catch (e) {}`,
    `  if (name.indexOf(${JSON.stringify(title)}) !== -1) found = { el: w, label: name };`,
    `  if (!found) {`,
    `    var sheets = []; try { sheets = w.sheets(); } catch (e) {}`,
    `    for (var j = 0; j < sheets.length && !found; j++) {`,
    `      var s = sheets[j];`,
    `      var st = ""; try { var sts = s.staticTexts(); if (sts.length > 0) st = sts[0].value(); } catch (e) {}`,
    `      if (st.indexOf(${JSON.stringify(title)}) !== -1) found = { el: s, label: st };`,
    `    }`,
    `  }`,
    `}`,
    `if (!found) throw new Error("mac-driver: no dialog titled " + ${JSON.stringify(title)});`,
  ].join("\n");
}

/** JXA that answers a native dialog by clicking its resolved button. */
export function buildAnswerDialogScript(app, title, choice) {
  const target = dialogButtonTitle(title, choice);
  const index = { first: 0, second: 1, third: 2 }[choice] ?? -1;
  if (index < 0) throw new Error(`mac-driver: choice ${JSON.stringify(choice)} clicks no button (use key("Escape"))`);
  const click =
    target !== null
      ? [
          `var want = ${JSON.stringify(target)};`,
          `var hit = null;`,
          `for (var k = 0; k < btns.length; k++) { var t = ""; try { t = btns[k].title(); } catch (e) {} if (t === want) { hit = btns[k]; break; } }`,
          `if (!hit) throw new Error("mac-driver: dialog has no button titled " + want);`,
          `hit.click();`,
          `JSON.stringify({ clicked: want });`,
        ].join("\n")
      : [
          `if (btns.length <= ${index}) throw new Error("mac-driver: dialog has no button at index ${index}");`,
          `btns[${index}].click();`,
          `JSON.stringify({ clicked: "button " + (${index} + 1) });`,
        ].join("\n");
  return [findDialogFragment(app, title), `var btns = found.el.buttons();`, click].join("\n");
}

/** JXA that lists a dialog's buttons as JSON [{title, x, y}] (centers). */
export function buildDialogButtonsScript(app, title) {
  return [
    findDialogFragment(app, title),
    `var btns = found.el.buttons();`,
    `var out = [];`,
    `for (var k = 0; k < btns.length; k++) {`,
    `  var pos = btns[k].position(); var size = btns[k].size();`,
    `  var t = ""; try { t = btns[k].title(); } catch (e) {}`,
    `  out.push({ title: t, x: pos[0] + size[0] / 2, y: pos[1] + size[1] / 2 });`,
    `}`,
    `JSON.stringify(out);`,
  ].join("\n");
}

/** JXA that clicks one dialog button by title. */
export function buildClickButtonScript(app, title, buttonTitle) {
  return [
    findDialogFragment(app, title),
    `var btns = found.el.buttons();`,
    `var hit = null;`,
    `for (var k = 0; k < btns.length; k++) { var t = ""; try { t = btns[k].title(); } catch (e) {} if (t === ${JSON.stringify(buttonTitle)}) { hit = btns[k]; break; } }`,
    `if (!hit) throw new Error("mac-driver: dialog has no button titled " + ${JSON.stringify(buttonTitle)});`,
    `hit.click();`,
    `JSON.stringify({ clicked: ${JSON.stringify(buttonTitle)} });`,
  ].join("\n");
}

/** JXA that reports a window's geometry as JSON {x, y, width, height}. */
export function buildGeometryScript(app, windowIndex) {
  return [
    `var se = Application("System Events");`,
    `var proc = se.processes.byName(${JSON.stringify(app)});`,
    `var w = proc.windows()[${windowIndex - 1}];`,
    `var pos = w.position(); var size = w.size();`,
    `JSON.stringify({ x: pos[0], y: pos[1], width: size[0], height: size[1] });`,
  ].join("\n");
}

/** JXA that raises a window (AXRaise, falling back to app activate). */
export function buildRaiseScript(app, windowIndex) {
  return [
    `var se = Application("System Events");`,
    `var proc = se.processes.byName(${JSON.stringify(app)});`,
    `var w = proc.windows()[${windowIndex - 1}];`,
    `var raised = false;`,
    `try { var acts = w.actions.whose({name: "AXRaise"}); if (acts.length > 0) { acts[0].perform(); raised = true; } } catch (e) {}`,
    `if (!raised) Application(${JSON.stringify(app)}).activate();`,
  ].join("\n");
}

/** JXA that closes a window via its AX close button, else Cmd+W. */
export function buildCloseWindowScript(app, windowIndex) {
  return [
    `var se = Application("System Events");`,
    `var proc = se.processes.byName(${JSON.stringify(app)});`,
    `var w = proc.windows()[${windowIndex - 1}];`,
    `var closed = false;`,
    `try { var btns = w.buttons.whose({subrole: "AXCloseButton"}); if (btns.length > 0) { btns[0].click(); closed = true; } } catch (e) {}`,
    `if (!closed) { Application(${JSON.stringify(app)}).activate(); delay(0.3); se.keystroke("w", {using: "command down"}); closed = true; }`,
    `JSON.stringify({ closed: closed });`,
  ].join("\n");
}

// ── Live runner ──────────────────────────────────────────────────────────

/** Run one JXA script via osascript; returns trimmed stdout. */
export async function osascript(script, { timeoutMs = 30000 } = {}) {
  requireMac();
  const dir = process.env.MAC_DRIVER_TMPDIR ?? path.join(process.cwd(), ".mac-driver-tmp");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `mac-driver-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  try {
    await writeFile(file, script, "utf8");
    const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", file], { timeout: timeoutMs });
    return stdout.trim();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr).trim() : "";
    throw new Error(`mac-driver osascript failed: ${detail}${stderr ? ` — ${stderr}` : ""}`);
  } finally {
    await rm(file, { force: true });
  }
}

async function runJson(script) {
  const out = await osascript(script);
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`mac-driver: unparseable osascript output: ${JSON.stringify(out)}`);
  }
}

function parseWid(wid) {
  let m = /^window:(\d+)$/.exec(String(wid));
  if (m) return { kind: "window", windowIndex: Number(m[1]), sheetIndex: 0 };
  m = /^sheet:(\d+):(\d+)$/.exec(String(wid));
  if (m) return { kind: "sheet", windowIndex: Number(m[1]), sheetIndex: Number(m[2]) };
  throw new Error(`mac-driver: bad window id ${JSON.stringify(wid)}`);
}

/** All windows + sheets of the app: [{kind, wid, title, windowIndex, sheetIndex}]. */
export async function listWindows() {
  return runJson(buildListWindowsScript(APP_NAME));
}

/** Window ids whose title contains `name` (substring match, sheets included). */
export async function searchWindows(name) {
  const wins = await listWindows();
  return wins.filter((w) => w.title.includes(name)).map((w) => w.wid);
}

export async function countWindows(name) {
  return (await searchWindows(name)).length;
}

/** Poll until a window/sheet titled `name` exists; returns its id, or null. */
export async function waitForWindow(name, { timeout = 20000, interval = 500 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const found = await searchWindows(name);
    if (found.length > 0) return found[0];
    if (Date.now() > deadline) return null;
    await sleep(interval);
  }
}

/** Poll until no window/sheet titled `name` exists; true when gone. */
export async function waitForWindowGone(name, { timeout = 20000, interval = 500 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if ((await searchWindows(name)).length === 0) return true;
    if (Date.now() > deadline) return false;
    await sleep(interval);
  }
}

export async function activateWindow(wid) {
  await osascript(buildRaiseScript(APP_NAME, parseWid(wid).windowIndex));
}

/** Bring the app to the front; throws when it has no windows (not running). */
export async function activateApp() {
  const wins = await listWindows();
  if (wins.length === 0) throw new Error("mac-driver: Titer has no windows — is the app running?");
  await osascript(`Application(${JSON.stringify(APP_NAME)}).activate();`);
}

/** Close a window via its AX close button (Cmd+W fallback). */
export async function closeWindow(wid) {
  await osascript(buildCloseWindowScript(APP_NAME, parseWid(wid).windowIndex));
}

/** Send keys to the frontmost app, e.g. key("ctrl+n"), key("Return"). */
export async function key(keys) {
  await osascript(buildKeyScript(APP_NAME, keys));
}

export async function typeText(text) {
  await osascript(buildTypeScript(APP_NAME, text));
}

/**
 * Drive a native file panel: wait for it, Cmd+Shift+G, type the full
 * path, Return. A save panel needs a second Return to confirm (the first
 * only fills folder + name); an open panel opens on the first, so the
 * second Return is sent only if the panel is still up. Returns the
 * panel's window id. The caller asserts the outcome (file on disk /
 * import ran) — the panel closing alone proves nothing.
 */
export async function typePathIntoChooser(title, filePath, { timeout = 20000 } = {}) {
  const wid = await waitForWindow(title, { timeout });
  if (!wid) throw new Error(`mac-driver: chooser ${JSON.stringify(title)} never appeared`);
  await activateWindow(wid);
  await sleep(400);
  await osascript(buildGoToFolderScript(filePath));
  await sleep(600);
  if ((await searchWindows(title)).length > 0) {
    await key("Return");
  }
  return wid;
}

/**
 * Answer a native NSAlert by clicking its button by title:
 *   choice "first"  -> Save / Delete / Update Now
 *   choice "second" -> Don't Save / Later / Cancel
 *   choice "third"  -> Cancel
 *   choice "escape" -> Escape (cancel)
 * The caller MUST verify the outcome (dialog gone, and the state the
 * answer implies); a wrong title table is visible there, not silent.
 */
export async function answerNativeDialog(title, choice, { timeout = 20000 } = {}) {
  const wid = await waitForWindow(title, { timeout });
  if (!wid) throw new Error(`mac-driver: native dialog ${JSON.stringify(title)} never appeared`);
  await activateWindow(wid);
  await sleep(400);
  if (choice === "escape") await key("Escape");
  else await osascript(buildAnswerDialogScript(APP_NAME, title, choice));
  return wid;
}

/** Geometry of a window id: { x, y, width, height } (outer, incl. frame). */
export async function windowGeometry(wid) {
  return runJson(buildGeometryScript(APP_NAME, parseWid(wid).windowIndex));
}

let cliclickCache = null;
async function cliclickPath() {
  if (cliclickCache !== null) return cliclickCache;
  try {
    const { stdout } = await execFileAsync("which", ["cliclick"]);
    cliclickCache = stdout.trim() || null;
  } catch {
    cliclickCache = null;
  }
  return cliclickCache;
}

/**
 * Click inside a native dialog at a horizontal fraction of its width, on
 * the button row near the bottom. Prefers the AX button nearest the
 * target point (no extra tooling); falls back to a raw CG click via
 * cliclick when no button sits near it. Fractions are calibrated live
 * per dialog and recorded in the calling spec — never assumed from one run.
 */
export async function clickDialogButtonAt(title, fracX, { yFromBottom = 25 } = {}) {
  const wid = await waitForWindow(title);
  if (!wid) throw new Error(`mac-driver: native dialog ${JSON.stringify(title)} never appeared`);
  const g = await windowGeometry(wid);
  const x = Math.round(g.x + g.width * fracX);
  const y = Math.round(g.y + g.height - yFromBottom);
  const buttons = await runJson(buildDialogButtonsScript(APP_NAME, title));
  let best = null;
  let bestD = Infinity;
  for (const b of buttons) {
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (best && bestD <= 80) {
    await osascript(buildClickButtonScript(APP_NAME, title, best.title));
    return { x: best.x, y: best.y, button: best.title };
  }
  const cliclick = await cliclickPath();
  if (cliclick) {
    await execFileAsync(cliclick, [`c:${x},${y}`]);
    return { x, y, button: null };
  }
  throw new Error(
    `mac-driver: no button near (${x}, ${y}) in dialog ${JSON.stringify(title)} and cliclick is not installed (brew install cliclick)`,
  );
}

/** PIDs of processes whose command line matches `pattern` (exact, no self-match). */
export async function pidsFor(pattern) {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", pattern]);
    return stdout.trim().split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Poll until no process matches `pattern`; true when gone. */
export async function waitForProcessGone(pattern, { timeout = 20000, interval = 500 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if ((await pidsFor(pattern)).length === 0) return true;
    if (Date.now() > deadline) return false;
    await sleep(interval);
  }
}

// ── Mac-only: native menus ───────────────────────────────────────────────

/**
 * Click a menu item: clickMenuItem("Help", "Titer on GitHub"). One
 * osascript call opens the menu and clicks the leaf — never split across
 * calls (the menu closes between them).
 */
export async function clickMenuItem(menu, item) {
  await osascript(buildMenuPathScript(APP_NAME, [menu, item]));
}

/** Click a menu path, e.g. ["File", "Export", "Export Graph…"]. */
export async function clickMenuPath(menuPath) {
  await osascript(buildMenuPathScript(APP_NAME, menuPath));
}

/** One menu's items: [{title, enabled}] (separators have an empty title). */
export async function menuItems(menu) {
  return runJson(buildMenuItemsScript(APP_NAME, menu));
}

/** Whether one menu item is enabled. */
export async function menuItemEnabled(menu, item) {
  return runJson(buildMenuItemEnabledScript(APP_NAME, menu, item));
}
