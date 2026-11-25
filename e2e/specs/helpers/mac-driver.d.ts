// Types for e2e/specs/helpers/mac-driver.js (plain JS — tsconfig covers
// src + tests only, so the checks.ts pin needs this declaration file).
// Keep in sync with mac-driver.js; the pin asserts the surface at runtime.

export declare const APP_NAME: string;

export declare const sleep: (ms: number) => Promise<void>;

export declare function translateKey(keys: string): string;
export declare function buildKeyScript(app: string, keys: string): string;
export declare function buildTypeScript(app: string, text: string): string;
export declare function buildGoToFolderScript(filePath: string): string;
export declare function buildListWindowsScript(app: string): string;
export declare function buildMenuPathScript(app: string, path: string[]): string;
export declare function buildMenuItemsScript(app: string, menu: string): string;
export declare function buildMenuItemEnabledScript(app: string, menu: string, item: string): string;
export declare function dialogButtonTitle(title: string, choice: string): string | null;
export declare function buildAnswerDialogScript(app: string, title: string, choice: string): string;
export declare function buildDialogButtonsScript(app: string, title: string): string;
export declare function buildClickButtonScript(app: string, title: string, buttonTitle: string): string;
export declare function buildGeometryScript(app: string, windowIndex: number): string;
export declare function buildRaiseScript(app: string, windowIndex: number): string;
export declare function buildCloseWindowScript(app: string, windowIndex: number): string;

export interface MacWindow {
  kind: "window" | "sheet";
  wid: string;
  title: string;
  windowIndex: number;
  sheetIndex: number;
}
export interface MacGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface MacMenuItem {
  title: string;
  enabled: boolean;
}
export interface MacDialogButton {
  title: string;
  x: number;
  y: number;
}

export declare function osascript(script: string, opts?: { timeoutMs?: number }): Promise<string>;
export declare function listWindows(): Promise<MacWindow[]>;
export declare function searchWindows(name: string): Promise<string[]>;
export declare function countWindows(name: string): Promise<number>;
export declare function waitForWindow(
  name: string,
  opts?: { timeout?: number; interval?: number },
): Promise<string | null>;
export declare function waitForWindowGone(
  name: string,
  opts?: { timeout?: number; interval?: number },
): Promise<boolean>;
export declare function activateWindow(wid: string): Promise<void>;
export declare function activateApp(): Promise<void>;
export declare function closeWindow(wid: string): Promise<void>;
export declare function key(keys: string): Promise<void>;
export declare function typeText(text: string): Promise<void>;
export declare function typePathIntoChooser(
  title: string,
  filePath: string,
  opts?: { timeout?: number },
): Promise<string>;
export declare function answerNativeDialog(
  title: string,
  choice: "first" | "second" | "third" | "escape",
  opts?: { timeout?: number },
): Promise<string>;
export declare function windowGeometry(wid: string): Promise<MacGeometry>;
export declare function clickDialogButtonAt(
  title: string,
  fracX: number,
  opts?: { yFromBottom?: number },
): Promise<{ x: number; y: number; button: string | null }>;
export declare function pidsFor(pattern: string): Promise<string[]>;
export declare function waitForProcessGone(
  pattern: string,
  opts?: { timeout?: number; interval?: number },
): Promise<boolean>;
export declare function clickMenuItem(menu: string, item: string): Promise<void>;
export declare function clickMenuPath(menuPath: string[]): Promise<void>;
export declare function menuItems(menu: string): Promise<MacMenuItem[]>;
export declare function menuItemEnabled(menu: string, item: string): Promise<boolean>;
