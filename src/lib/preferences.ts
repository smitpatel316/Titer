// Preferences (seq 225 remainder): the per-Mac settings Prism's
// Preferences dialog offers that Titer's dialog was missing — note font,
// default font, measurement units, title autocomplete, graph alerts, new
// graph defaults, P-value format, file locations, clipboard options, info
// auto-create, extended logging. One home per setting, the same pattern as
// the theme / decimal separator / print settings: a localStorage key, a
// load/save pair that never throws, and a changed event so the consumer
// re-reads at once. The Zoom reset lives in the zoom store (use-zoom.tsx);
// the print options (grid lines, column titles, header) live in
// print-settings.ts, with the print settings they belong to. Pure (no
// React): the note-font hook lives in note-font.ts so figure.ts and
// format.ts can import this module and stay pure.

// ── Note Font (F16) ──────────────────────────────────────────────────────

/** The font an Info sheet and a floating note is set in. */
export type NoteFont = "system" | "arial" | "times" | "courier";

export const NOTE_FONT_KEY = "titer.note-font";

/** The event the Preferences dialog dispatches after changing the note
 *  font, so Info sheets and floating notes re-read it at once. */
export const NOTE_FONT_CHANGED_EVENT = "titer:note-font-changed";

/** The note font as a CSS family: the system UI font, or the chosen face. */
export function noteFontFamily(font: NoteFont): string {
  switch (font) {
    case "arial":
      return "Arial, Helvetica, sans-serif";
    case "times":
      return "'Times New Roman', Times, serif";
    case "courier":
      return "'Courier New', Courier, monospace";
    case "system":
    default:
      return "system-ui, -apple-system, sans-serif";
  }
}

/** The stored note font, or "system" when nothing (or nothing usable) is
 *  stored. Never throws. */
export function loadNoteFont(): NoteFont {
  try {
    const font = localStorage.getItem(NOTE_FONT_KEY);
    return font === "arial" || font === "times" || font === "courier" ? font : "system";
  } catch {
    return "system";
  }
}

/** Persist the note font and tell the notes to re-read it. */
export function saveNoteFont(font: NoteFont): void {
  try {
    localStorage.setItem(NOTE_FONT_KEY, font);
  } catch {
    // Not kept: the next launch uses the system font.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTE_FONT_CHANGED_EVENT));
}

// ── Default Font (L3) ────────────────────────────────────────────────────

/** The font new graphs and figures are set in. */
export type DefaultFont = "arial" | "helvetica" | "times" | "courier";

export const DEFAULT_FONT_KEY = "titer.default-font";

/** The event the Preferences dialog dispatches after changing the default
 *  font, so figures re-read it at once. */
export const DEFAULT_FONT_CHANGED_EVENT = "titer:default-font-changed";

/** The default font as a CSS family. */
export function defaultFontFamily(font: DefaultFont): string {
  switch (font) {
    case "helvetica":
      return "Helvetica, Arial, sans-serif";
    case "times":
      return "'Times New Roman', Times, serif";
    case "courier":
      return "'Courier New', Courier, monospace";
    case "arial":
    default:
      return "Arial, Helvetica, sans-serif";
  }
}

/** The stored default font, or "arial" when nothing (or nothing usable) is
 *  stored. Never throws. */
export function loadDefaultFont(): DefaultFont {
  try {
    const font = localStorage.getItem(DEFAULT_FONT_KEY);
    return font === "helvetica" || font === "times" || font === "courier" ? font : "arial";
  } catch {
    return "arial";
  }
}

/** Persist the default font and tell the figures to re-read it. */
export function saveDefaultFont(font: DefaultFont): void {
  try {
    localStorage.setItem(DEFAULT_FONT_KEY, font);
  } catch {
    // Not kept: the next launch uses Arial.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DEFAULT_FONT_CHANGED_EVENT));
}

// ── Measurement Units (L4) ───────────────────────────────────────────────

/** The unit figure sizes are shown in. */
export type MeasurementUnit = "in" | "cm";

export const MEASUREMENT_UNIT_KEY = "titer.measurement-unit";

/** The event the Preferences dialog dispatches after changing the unit, so
 *  size displays re-read it at once. */
export const MEASUREMENT_UNIT_CHANGED_EVENT = "titer:measurement-unit-changed";

/** The stored unit, or inches when nothing (or nothing usable) is stored.
 *  Never throws. */
export function loadMeasurementUnit(): MeasurementUnit {
  try {
    return localStorage.getItem(MEASUREMENT_UNIT_KEY) === "cm" ? "cm" : "in";
  } catch {
    return "in";
  }
}

/** Persist the unit and tell the size displays to re-read it. */
export function saveMeasurementUnit(unit: MeasurementUnit): void {
  try {
    localStorage.setItem(MEASUREMENT_UNIT_KEY, unit);
  } catch {
    // Not kept: the next launch uses inches.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MEASUREMENT_UNIT_CHANGED_EVENT));
}

/** An inches length in the preferred unit: "8.5 in", or "21.6 cm". */
export function formatLength(inches: number, unit: MeasurementUnit = loadMeasurementUnit()): string {
  if (unit === "cm") return `${(inches * 2.54).toFixed(1).replace(/\.0$/, "")} cm`;
  return `${inches.toFixed(2).replace(/\.?0+$/, "")} in`;
}

// ── Autocomplete Titles (L5) ─────────────────────────────────────────────

/** Whether a new graph's title is suggested from its source table. */
export const AUTOCOMPLETE_TITLES_KEY = "titer.autocomplete-titles";

/** The event the Preferences dialog dispatches after changing the
 *  preference, so graph creation re-reads it at once. */
export const AUTOCOMPLETE_TITLES_CHANGED_EVENT = "titer:autocomplete-titles-changed";

/** Whether title autocomplete is on — true when nothing (or nothing
 *  usable) is stored. Never throws. */
export function loadAutocompleteTitles(): boolean {
  try {
    return localStorage.getItem(AUTOCOMPLETE_TITLES_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Persist the preference and tell graph creation to re-read it. */
export function saveAutocompleteTitles(on: boolean): void {
  try {
    localStorage.setItem(AUTOCOMPLETE_TITLES_KEY, on ? "1" : "0");
  } catch {
    // Not kept: the next launch autocompletes titles.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTOCOMPLETE_TITLES_CHANGED_EVENT));
}

// ── Graph Alerts (L6) ────────────────────────────────────────────────────

/** Whether a graph warns when it has nothing to draw. */
export const GRAPH_ALERTS_KEY = "titer.graph-alerts";

/** The event the Preferences dialog dispatches after changing the
 *  preference, so graphs re-read it at once. */
export const GRAPH_ALERTS_CHANGED_EVENT = "titer:graph-alerts-changed";

/** Whether graph alerts are on — true when nothing (or nothing usable) is
 *  stored. Never throws. */
export function loadGraphAlerts(): boolean {
  try {
    return localStorage.getItem(GRAPH_ALERTS_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Persist the preference and tell the graphs to re-read it. */
export function saveGraphAlerts(on: boolean): void {
  try {
    localStorage.setItem(GRAPH_ALERTS_KEY, on ? "1" : "0");
  } catch {
    // Not kept: the next launch warns.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(GRAPH_ALERTS_CHANGED_EVENT));
}

// ── New Graph Defaults (L11) ─────────────────────────────────────────────

/** What a new graph starts with: points shown, and the error-bar style. */
export interface NewGraphDefaults {
  showPoints: boolean;
  /** "sem" (the usual default) or "none" (no error bars). */
  error: "sem" | "none";
}

export const DEFAULT_NEW_GRAPH_DEFAULTS: NewGraphDefaults = { showPoints: false, error: "sem" };

export const NEW_GRAPH_DEFAULTS_KEY = "titer.new-graph-defaults";

/** The event the Preferences dialog dispatches after changing the
 *  defaults, so graph creation re-reads them at once. */
export const NEW_GRAPH_DEFAULTS_CHANGED_EVENT = "titer:new-graph-defaults-changed";

/** The stored new-graph defaults, or the usual defaults when nothing (or
 *  nothing usable) is stored. Never throws. */
export function loadNewGraphDefaults(): NewGraphDefaults {
  try {
    const saved = JSON.parse(localStorage.getItem(NEW_GRAPH_DEFAULTS_KEY) ?? "null") as Partial<NewGraphDefaults> | null;
    if (!saved || typeof saved !== "object") return DEFAULT_NEW_GRAPH_DEFAULTS;
    return {
      showPoints: saved.showPoints === true,
      error: saved.error === "none" ? "none" : "sem",
    };
  } catch {
    return DEFAULT_NEW_GRAPH_DEFAULTS;
  }
}

/** Persist the defaults and tell graph creation to re-read them. */
export function saveNewGraphDefaults(defaults: NewGraphDefaults): void {
  try {
    localStorage.setItem(NEW_GRAPH_DEFAULTS_KEY, JSON.stringify(defaults));
  } catch {
    // Not kept: the next graph uses the usual defaults.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NEW_GRAPH_DEFAULTS_CHANGED_EVENT));
}

// ── P-value Format (L12) ─────────────────────────────────────────────────

/** How a small P value is written: below the threshold it shows as "<". */
export type PValueFormat = "p<0.0001" | "p<0.001" | "exact";

export const P_VALUE_FORMAT_KEY = "titer.p-value-format";

/** The event the Preferences dialog dispatches after changing the format,
 *  so results re-read it at once. */
export const P_VALUE_FORMAT_CHANGED_EVENT = "titer:p-value-format-changed";

/** The stored P-value format, or "p<0.0001" when nothing (or nothing
 *  usable) is stored. Never throws. */
export function loadPValueFormat(): PValueFormat {
  try {
    const format = localStorage.getItem(P_VALUE_FORMAT_KEY);
    return format === "p<0.001" || format === "exact" ? format : "p<0.0001";
  } catch {
    return "p<0.0001";
  }
}

/** Persist the format and tell the results to re-read it. */
export function savePValueFormat(format: PValueFormat): void {
  try {
    localStorage.setItem(P_VALUE_FORMAT_KEY, format);
  } catch {
    // Not kept: the next launch uses "<0.0001".
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(P_VALUE_FORMAT_CHANGED_EVENT));
}

/** The threshold below which a P value shows as "<" — 0 for exact. */
export function pValueThreshold(format: PValueFormat = loadPValueFormat()): number {
  return format === "exact" ? 0 : format === "p<0.001" ? 0.001 : 0.0001;
}

// ── File Locations (L14) ─────────────────────────────────────────────────

/** The default folders new projects are saved in and exports go to. */
export interface DefaultLocations {
  projectsFolder: string;
  exportsFolder: string;
}

export const DEFAULT_LOCATIONS: DefaultLocations = { projectsFolder: "", exportsFolder: "" };

export const DEFAULT_LOCATIONS_KEY = "titer.default-locations";

/** The event the Preferences dialog dispatches after changing the folders,
 *  so save dialogs re-read them at once. */
export const DEFAULT_LOCATIONS_CHANGED_EVENT = "titer:default-locations-changed";

/** The stored folders, or empty (the OS default) when nothing is stored.
 *  Never throws. */
export function loadDefaultLocations(): DefaultLocations {
  try {
    const saved = JSON.parse(localStorage.getItem(DEFAULT_LOCATIONS_KEY) ?? "null") as Partial<DefaultLocations> | null;
    if (!saved || typeof saved !== "object") return DEFAULT_LOCATIONS;
    return {
      projectsFolder: typeof saved.projectsFolder === "string" ? saved.projectsFolder : "",
      exportsFolder: typeof saved.exportsFolder === "string" ? saved.exportsFolder : "",
    };
  } catch {
    return DEFAULT_LOCATIONS;
  }
}

/** Persist the folders and tell the save dialogs to re-read them. */
export function saveDefaultLocations(locations: DefaultLocations): void {
  try {
    localStorage.setItem(DEFAULT_LOCATIONS_KEY, JSON.stringify(locations));
  } catch {
    // Not kept: the next save uses the OS default.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DEFAULT_LOCATIONS_CHANGED_EVENT));
}

/** A save dialog's starting folder: the preferred folder when one is set,
 *  else the caller's fallback. */
export function defaultSaveFolder(kind: "projects" | "exports", fallback: string): string {
  const locations = loadDefaultLocations();
  const folder = kind === "projects" ? locations.projectsFolder : locations.exportsFolder;
  return folder.trim() ? folder.trim() : fallback;
}

// ── Clipboard Options (L10) ──────────────────────────────────────────────

/** What a table copy includes: the column titles above the copied cells,
 *  and the row titles beside them. */
export interface ClipboardOptions {
  includeColumnTitles: boolean;
  includeRowTitles: boolean;
}

export const DEFAULT_CLIPBOARD_OPTIONS: ClipboardOptions = {
  includeColumnTitles: false,
  includeRowTitles: false,
};

export const CLIPBOARD_OPTIONS_KEY = "titer.clipboard-options";

/** The event the Preferences dialog dispatches after changing the options,
 *  so the grid re-reads them at once. */
export const CLIPBOARD_OPTIONS_CHANGED_EVENT = "titer:clipboard-options-changed";

/** The stored clipboard options, or the current copy shape (neither title)
 *  when nothing (or nothing usable) is stored. Never throws. */
export function loadClipboardOptions(): ClipboardOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(CLIPBOARD_OPTIONS_KEY) ?? "null") as Partial<ClipboardOptions> | null;
    if (!saved || typeof saved !== "object") return DEFAULT_CLIPBOARD_OPTIONS;
    return {
      includeColumnTitles: saved.includeColumnTitles === true,
      includeRowTitles: saved.includeRowTitles === true,
    };
  } catch {
    return DEFAULT_CLIPBOARD_OPTIONS;
  }
}

/** Persist the options and tell the grid to re-read them. */
export function saveClipboardOptions(options: ClipboardOptions): void {
  try {
    localStorage.setItem(CLIPBOARD_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // Not kept: the next copy takes neither title.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLIPBOARD_OPTIONS_CHANGED_EVENT));
}

// ── Info Auto-create (L13) ───────────────────────────────────────────────

/** Whether a new data table gets a linked Info sheet with it. Prism does;
 *  Titer's tables start bare, so this is off until the user asks for it. */
export const AUTO_CREATE_INFO_KEY = "titer.auto-create-info";

/** The event the Preferences dialog dispatches after changing the
 *  preference, so table creation re-reads it at once. */
export const AUTO_CREATE_INFO_CHANGED_EVENT = "titer:auto-create-info-changed";

/** Whether new tables get an Info sheet — false when nothing (or nothing
 *  usable) is stored. Never throws. */
export function loadAutoCreateInfo(): boolean {
  try {
    return localStorage.getItem(AUTO_CREATE_INFO_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the preference and tell table creation to re-read it. */
export function saveAutoCreateInfo(on: boolean): void {
  try {
    localStorage.setItem(AUTO_CREATE_INFO_KEY, on ? "1" : "0");
  } catch {
    // Not kept: the next table starts bare.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTO_CREATE_INFO_CHANGED_EVENT));
}

// ── Extended Log File (L16) ──────────────────────────────────────────────

/** Whether error reports carry the extended detail (user agent, full
 *  context) for the local log file. */
export const EXTENDED_LOG_KEY = "titer.extended-log";

/** The event the Preferences dialog dispatches after changing the
 *  preference, so error capture re-reads it at once. */
export const EXTENDED_LOG_CHANGED_EVENT = "titer:extended-log-changed";

/** Whether the extended log is on — false when nothing (or nothing usable)
 *  is stored. Never throws. */
export function loadExtendedLog(): boolean {
  try {
    return localStorage.getItem(EXTENDED_LOG_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the preference and tell error capture to re-read it. */
export function saveExtendedLog(on: boolean): void {
  try {
    localStorage.setItem(EXTENDED_LOG_KEY, on ? "1" : "0");
  } catch {
    // Not kept: the next error logs the minimum.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EXTENDED_LOG_CHANGED_EVENT));
}
