// Shared xdotool driver for the wdio lane (check/e2e-conversion).
//
// WHY xdotool: the native GTK dialogs (file choosers, Save / Don't Save /
// Cancel, Delete confirm, update prompt) and the native menu bar live
// OUTSIDE the webview, so WebDriver cannot see, click, or read them. MCP
// cannot reach them either — MCP tools take paths directly and never open
// a picker, and the close-allowance in mcp-document.ts deliberately skips
// the save prompt. These flows are therefore wdio + xdotool by necessity,
// not by preference. Everything DOM-side stays in WebDriver.
//
// Every wait retries on a poll loop: AX probes lie under load and GTK
// choosers take a moment to map — never conclude from a single probe.
// All helpers run against the DISPLAY the app runs on (inherited from the
// wdio process env); they never guess a display.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DISPLAY = process.env.DISPLAY ?? ":99";
const env = { ...process.env, DISPLAY };

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function xdotool(...args) {
  return execFileAsync("xdotool", args, { env });
}

/** Window ids whose title contains `name` (substring match). */
export async function searchWindows(name) {
  // Fast path: `search --name` matches WM_NAME. It works for the GTK file
  // choosers (Save/Open Project) and any window that sets WM_NAME.
  try {
    const { stdout } = await xdotool("search", "--onlyvisible", "--name", name);
    const found = stdout.trim().split("\n").map((s) => s.trim()).filter(Boolean);
    if (found.length > 0) return found;
  } catch {
    // No match — fall through to the _NET_WM_NAME scan below.
  }
  // Fallback: plugin-dialog `message` dialogs (the Delete confirm, the quit
  // save prompt, the update prompt) set ONLY _NET_WM_NAME, never WM_NAME —
  // proven 2026-11-18 by xprop on the Delete dialog (WM_CLASS "titer",
  // _NET_WM_NAME "Delete “Table 2”?", no WM_NAME line at all) — so
  // `search --name` can never match them, not even on an ASCII substring.
  // `getwindowname` reads _NET_WM_NAME, so scan the visible top-level
  // windows and match in JS. The intersection matters: `--onlyvisible`
  // excludes the unmapped-but-lingering chooser windows (which must stay
  // gone for waitForWindowGone), and _NET_CLIENT_LIST excludes the ~60
  // WebKit child windows, keeping the scan to a handful of getwindowname
  // calls per poll.
  try {
    const { stdout: vis } = await xdotool("search", "--onlyvisible", "--name", "");
    const visible = new Set(vis.trim().split("\n").map((s) => s.trim()).filter(Boolean));
    const { stdout: list } = await execFileAsync("xprop", ["-root", "_NET_CLIENT_LIST"], { env });
    const ids = [...list.matchAll(/0x[0-9a-f]+/gi)].map((m) => String(parseInt(m[0], 16)));
    const out = [];
    for (const id of ids) {
      if (!visible.has(id)) continue;
      try {
        const { stdout: title } = await xdotool("getwindowname", id);
        if (title.includes(name)) out.push(id);
      } catch {
        // A window that closed mid-scan; skip it.
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function countWindows(name) {
  return (await searchWindows(name)).length;
}

/** Poll until a window titled `name` exists; returns its id, or null. */
export async function waitForWindow(name, { timeout = 20000, interval = 500 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const found = await searchWindows(name);
    if (found.length > 0) return found[0];
    if (Date.now() > deadline) return null;
    await sleep(interval);
  }
}

/** Poll until no window titled `name` exists; true when gone. */
export async function waitForWindowGone(name, { timeout = 20000, interval = 500 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if ((await searchWindows(name)).length === 0) return true;
    if (Date.now() > deadline) return false;
    await sleep(interval);
  }
}

export async function activateWindow(wid) {
  // windowactivate needs a window manager (openbox runs on :99 for this
  // lane). If the WM is gone, fall back to windowfocus, which sets input
  // focus directly and needs no WM — keyboard input still lands.
  try {
    await xdotool("windowactivate", "--sync", wid);
  } catch {
    await xdotool("windowfocus", "--sync", wid);
  }
}

/** Send X keys to the focused window, e.g. key("ctrl+l"), key("Return"). */
export async function key(keys) {
  await xdotool("key", keys);
}

export async function typeText(text) {
  await xdotool("type", "--delay", "25", text);
}

/**
 * Drive a GTK file chooser: wait for it, focus the location bar (Ctrl+L,
 * the recipe QA proved 3x in QA-LOG-LINUX.md), type the full path, Enter.
 * Returns the chooser's window id. The caller asserts the outcome (file
 * on disk / import ran) — the chooser closing alone proves nothing.
 */
export async function typePathIntoChooser(title, path, { timeout = 20000 } = {}) {
  const wid = await waitForWindow(title, { timeout });
  if (!wid) throw new Error(`GTK chooser ${JSON.stringify(title)} never appeared`);
  await activateWindow(wid);
  await sleep(400);
  await key("ctrl+l");
  await sleep(300);
  await typeText(path);
  await sleep(200);
  await key("Return");
  return wid;
}

/**
 * Answer a native rfd message dialog by keyboard. The dialog has no text
 * field, so Tab walks its buttons in layout order and Space activates the
 * focused one; the first button is focused by default.
 *   choice "first"  -> Space (Save / Delete / Update Now)
 *   choice "second" -> Tab, Space (Don't Save)
 *   choice "third"  -> Tab, Tab, Space (Cancel)
 *   choice "escape" -> Escape (cancel — rfd maps it to the cancel button)
 * The caller MUST verify the outcome (dialog gone, and the state the
 * answer implies); a mis-counted Tab is visible there, not silent.
 */
export async function answerNativeDialog(title, choice, { timeout = 20000 } = {}) {
  const wid = await waitForWindow(title, { timeout });
  if (!wid) throw new Error(`native dialog ${JSON.stringify(title)} never appeared`);
  await activateWindow(wid);
  await sleep(400);
  if (choice === "first") await key("space");
  else if (choice === "second") {
    await key("Tab");
    await sleep(200);
    await key("space");
  } else if (choice === "third") {
    await key("Tab");
    await sleep(200);
    await key("Tab");
    await sleep(200);
    await key("space");
  } else if (choice === "escape") await key("Escape");
  else throw new Error(`unknown native-dialog choice ${JSON.stringify(choice)}`);
  return wid;
}

/** Geometry of a window id: { x, y, width, height } (outer, incl. frame). */
export async function windowGeometry(wid) {
  const { stdout } = await xdotool("getwindowgeometry", "--shell", wid);
  const out = {};
  for (const line of stdout.trim().split("\n")) {
    const [k, v] = line.split("=");
    out[k] = Number(v);
  }
  return { x: out.X, y: out.Y, width: out.WIDTH, height: out.HEIGHT };
}

/**
 * Click inside a native dialog at a horizontal fraction of its width, on
 * the button row near the bottom. Fallback when keyboard answering cannot
 * distinguish the buttons; fractions are calibrated live per dialog and
 * recorded in the calling spec — never assumed from one run.
 */
export async function clickDialogButtonAt(title, fracX, { yFromBottom = 25 } = {}) {
  const wid = await waitForWindow(title);
  if (!wid) throw new Error(`native dialog ${JSON.stringify(title)} never appeared`);
  const g = await windowGeometry(wid);
  const x = Math.round(g.x + g.width * fracX);
  const y = Math.round(g.y + g.height - yFromBottom);
  await xdotool("mousemove", String(x), String(y));
  await sleep(200);
  await xdotool("click", "1");
  return { x, y };
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
