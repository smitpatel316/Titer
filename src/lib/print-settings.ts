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
  /** Print the data grid's cell borders (seq 225 remainder L9). */
  gridLines: boolean;
  /** Print the data grid's column titles (seq 225 remainder L9). */
  columnTitles: boolean;
  /** A line printed at the top of every page (seq 225 remainder L9). */
  headerText: string;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paperSize: "letter",
  orientation: "portrait",
  marginMm: 12,
  scale: 1,
  gridLines: false,
  columnTitles: true,
  headerText: "",
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
      gridLines: saved.gridLines === true,
      columnTitles: saved.columnTitles === false ? false : true,
      headerText: typeof saved.headerText === "string" ? saved.headerText : "",
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
export function printPageCss({ paperSize, orientation, marginMm, scale, gridLines, columnTitles, headerText }: PrintSettings): string {
  // The print options (seq 225 remainder L9): grid lines draw the data
  // grid's cell borders (the grid marks its cells `titer-grid-cell`),
  // column titles off hides the grid's header row (`titer-grid-header`),
  // and a header prints at the top of every page. The header text is
  // CSS-escaped: a quote or backslash in it must not break the rule.
  const extra: string[] = [];
  if (gridLines) extra.push(".titer-grid-cell { border: 1px solid #999 !important; }");
  if (!columnTitles) extra.push(".titer-grid-header { display: none !important; }");
  if (headerText.trim()) {
    const text = headerText.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    extra.push(`body::before { content: "${text}"; display: block; font-size: 10pt; margin-bottom: 6pt; }`);
  }
  return `@page { size: ${paperSize} ${orientation}; margin: ${marginMm}mm; }\n@media print { body { zoom: ${scale}; }${extra.length ? ` ${extra.join(" ")}` : ""} }`;
}
