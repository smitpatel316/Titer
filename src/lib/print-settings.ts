// Print settings (seq 227): the Page Setup choices — paper size,
// orientation, margins and scale — kept per Mac in localStorage, never in
// the .hlx file. `printPageCss` is the `@page` rule the shell injects, so
// File ▸ Print and a script's Print print on the chosen paper.
import { clamp } from "../store/types";

export type PaperSize = "letter" | "a4";
export type PrintOrientation = "portrait" | "landscape";

export interface PrintSettings {
  paperSize: PaperSize;
  orientation: PrintOrientation;
  /** Margin on every side, in millimetres (0–25). */
  marginMm: number;
  /** Content scale, as a fraction (0.5–2). */
  scale: number;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paperSize: "letter",
  orientation: "portrait",
  marginMm: 12,
  scale: 1,
};

const PRINT_KEY = "titer.print";

/** The event the Preferences dialog dispatches after changing the settings,
 *  so the shell re-injects the `@page` rule at once. */
export const PRINT_SETTINGS_CHANGED_EVENT = "titer:print-settings-changed";

/** The stored settings, or the defaults when nothing (or nothing usable)
 *  is stored. Never throws. */
export function loadPrintSettings(): PrintSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(PRINT_KEY) ?? "null") as Partial<PrintSettings> | null;
    if (!saved || typeof saved !== "object") return DEFAULT_PRINT_SETTINGS;
    return {
      paperSize: saved.paperSize === "a4" ? "a4" : "letter",
      orientation: saved.orientation === "landscape" ? "landscape" : "portrait",
      marginMm: typeof saved.marginMm === "number" ? clamp(saved.marginMm, { min: 0, max: 25 }) : DEFAULT_PRINT_SETTINGS.marginMm,
      scale: typeof saved.scale === "number" ? clamp(saved.scale, { min: 0.5, max: 2 }) : DEFAULT_PRINT_SETTINGS.scale,
    };
  } catch {
    return DEFAULT_PRINT_SETTINGS;
  }
}

/** Persist the settings and tell the shell to re-inject the `@page` rule. */
export function savePrintSettings(settings: PrintSettings): void {
  try {
    localStorage.setItem(PRINT_KEY, JSON.stringify(settings));
  } catch {
    // Not kept: the next print uses the defaults.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PRINT_SETTINGS_CHANGED_EVENT));
}

/** The `@page` rule for these settings, plus the content scale for print —
 *  the shell injects it into a `<style>` element, so it applies to
 *  `window.print()` from anywhere (File ▸ Print, a script's Print). */
export function printPageCss({ paperSize, orientation, marginMm, scale }: PrintSettings): string {
  return `@page { size: ${paperSize} ${orientation}; margin: ${marginMm}mm; }\n@media print { body { zoom: ${scale}; } }`;
}
