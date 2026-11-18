// Shared project-window + E2E-hook helpers for the wdio lane.
// (The launch smoke keeps its own copy in launch.e2e.js so it stays
// runnable standalone; these helpers are for the conversion specs.)
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_TIMEOUT = 60000;

// The app is an engine window (hidden, runs webR) plus one window per project.
// Find the project window by URL, then tell the tauri service its label: the
// service defaults every execute/mock to the window labelled "main", which
// this app does not have (its windows are "project-1", "engine"), so without
// switchWindow every browser.tauri.* call fails with "Window 'main' not found".
export async function switchToProjectWindow() {
  const handles = await browser.getWindowHandles();
  for (const handle of handles) {
    try {
      await browser.switchToWindow(handle);
      const url = await browser.getUrl();
      if (!url.includes("engine")) {
        await browser.tauri.switchWindow(handle);
        return handle;
      }
    } catch {
      // A hidden window may refuse the switch; try the next handle.
    }
  }
  throw new Error(`no project window among ${handles.length} handles`);
}

// All project-window handles (excludes the hidden engine window), in
// creation order. Used by the quit flows, which address windows one by one.
export async function projectWindowHandles() {
  const handles = await browser.getWindowHandles();
  const out = [];
  for (const handle of handles) {
    try {
      await browser.switchToWindow(handle);
      const url = await browser.getUrl();
      if (!url.includes("engine")) out.push(handle);
    } catch {
      // Skip windows that refuse the switch.
    }
  }
  return out;
}

// Switch the WebDriver + tauri service to a specific project window handle.
export async function switchToHandle(handle) {
  await browser.switchToWindow(handle);
  await browser.tauri.switchWindow(handle);
}

// Wait for the E2E hook (installed by a React useEffect in AppShell). A
// missing hook after the timeout is a harness/product failure, not a race:
// on a slow cold start (Linux, webR booting) it may not exist yet when the
// spec runs, so this polls.
export async function waitForHook(timeout = HOOK_TIMEOUT) {
  await browser.waitUntil(
    async () =>
      (await browser.tauri.execute(() => typeof window.__titerE2E?.openConverter)) === "function",
    { timeout, timeoutMsg: "e2e hook window.__titerE2E.openConverter never appeared" },
  );
}

// The daily update check can pop a native "x.y.z available" dialog on first
// launch (fresh app-data dir). It is NATIVE (plugin-dialog), so the DOM
// "Later" button the launch smoke probes for never exists for it; dismiss
// it via xdotool Escape if it is there, no-op if it is not.
export async function dismissUpdateDialogIfPresent(xdotoolHelpers) {
  const { searchWindows, activateWindow, key, sleep } = xdotoolHelpers;
  const found = await searchWindows("is available");
  if (found.length === 0) return false;
  await activateWindow(found[0]);
  await sleep(300);
  await key("Escape");
  await sleep(500);
  return true;
}

// Call a __titerE2E hook entry by name with args. browser.tauri.execute
// passes its extra args through after the Tauri APIs object.
export async function callHook(name, ...args) {
  return browser.tauri.execute((_tauri, n, a) => window.__titerE2E[n](...a), name, args);
}

// Read-only project summary from the hook (title, active node, tables).
export async function projectSummary() {
  return browser.tauri.execute(() => window.__titerE2E.projectSummary());
}

// True when the in-app Dialog with this title is open (native <dialog>).
export async function isDialogOpen(title) {
  return browser.tauri.execute(
    (_tauri, t) =>
      Boolean(
        [...document.querySelectorAll("dialog h2")].find((el) => el.textContent === t)?.closest("dialog")?.open,
      ),
    title,
  );
}

// Full text of the in-app Dialog with this title ("" when it is not open).
export async function dialogText(title) {
  return browser.tauri.execute((_tauri, t) => {
    const h = [...document.querySelectorAll("dialog h2")].find((el) => el.textContent === t);
    return h ? h.closest("dialog").textContent : "";
  }, title);
}

// Click a DOM button by its exact label, waiting until it exists.
export async function clickButton(label, timeout = 15000) {
  const button = await $(`button=${label}`);
  await button.waitForExist({ timeout });
  await button.click();
}

// Per-spec output dir for saved files + screenshots (gitignored e2e/out/).
export function specOutDir(specName) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.resolve(here, "..", "..", "out", "wdio", specName);
  mkdirSync(dir, { recursive: true });
  return dir;
}
