// Dates and elapsed times on an XY table's X column (Prism 11, seq 332).
//
// Prism lets an XY X column hold dates or elapsed times instead of plain
// numbers, and converts them to numbers — with user-chosen units and a start
// date — before any analysis or graph sees them. The cells keep their typed
// text; the conversion happens in readTable (src/lib/dataset.ts), so every
// consumer sees numbers while the grid still shows what was typed. A cell
// that can't be read shows "?" in the grid and counts as missing.
//
// Units are seconds/minutes/hours/days/weeks/years. A year is 365.25 days.
// There is no month unit: Prism has none (a month isn't a fixed length), and
// neither does Titer. All dates are UTC — a date has no timezone, and a
// local-midnight parse would shift it by the machine's offset.

import { parseCell } from "./numeric";

/** The three shapes an XY X column can hold. */
export const X_FORMATS = ["numbers", "date", "elapsed"] as const;
export type XColumnFormat = (typeof X_FORMATS)[number];
export const isXColumnFormat = (v: unknown): v is XColumnFormat =>
  v === "numbers" || v === "date" || v === "elapsed";

/** The units a date/elapsed X column converts to. No months: Prism has none. */
export const DATE_UNITS = ["seconds", "minutes", "hours", "days", "weeks", "years"] as const;
export type DateUnit = (typeof DATE_UNITS)[number];
export const isDateUnit = (v: unknown): v is DateUnit =>
  typeof v === "string" && (DATE_UNITS as readonly string[]).includes(v);

/** How a date/elapsed X column becomes numbers. */
export interface XConversion {
  /** The unit the values convert to (default "days"). */
  units: DateUnit;
  /** The zero of the conversion, as an ISO date ("2024-01-16"). Omitted =
   *  the earliest parseable date in the column. Date X only. */
  startDate?: string;
  /** Slash dates read day-first when true, month-first when false (default).
   *  A first component over 12 is always the day, either way. Date X only. */
  dayFirst?: boolean;
}

const MS_PER_DAY = 86400000;

/** Seconds in one unit. A year is 365.25 days — Prism's own convention. */
export function unitInSeconds(unit: DateUnit): number {
  switch (unit) {
    case "seconds":
      return 1;
    case "minutes":
      return 60;
    case "hours":
      return 3600;
    case "days":
      return MS_PER_DAY / 1000;
    case "weeks":
      return 7 * MS_PER_DAY / 1000;
    case "years":
      return 365.25 * MS_PER_DAY / 1000;
  }
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ms since the epoch for a UTC date, or null when the parts aren't a real date. */
function utcMs(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  ms = 0,
): number | null {
  const t = Date.UTC(year, month, day, hours, minutes, seconds, ms);
  const d = new Date(t);
  return d.getUTCFullYear() === year &&
    d.getUTCMonth() === month &&
    d.getUTCDate() === day &&
    d.getUTCHours() === hours &&
    d.getUTCMinutes() === minutes &&
    d.getUTCSeconds() === seconds
    ? t
    : null;
}

function monthFromName(name: string): number | null {
  const idx = MONTH_ABBR.findIndex((m) => m.toLowerCase() === name.slice(0, 3).toLowerCase());
  return idx === -1 ? null : idx;
}

/** A two-digit year reads the way spreadsheets read one: 00–69 is 2000s, 70–99 is 1900s. */
function fullYear(year: number): number {
  if (year < 100) return year <= 69 ? 2000 + year : 1900 + year;
  return year;
}

/**
 * Read one free-form date cell as ms since the epoch (UTC), or null when it
 * can't be read. Shapes: ISO ("2024-01-16", with an optional time and an
 * optional offset, which is ignored — a date has no timezone), a bare year
 * ("2024" = Jan 1), month names ("16-Jan-2004", "16 Jan 2004", "Sep 6, 2024",
 * "6 Sep 2024"), and slashes ("03/04/2024" — month-first by default, or
 * day-first when `dayFirst` is set; a first component over 12 is always the
 * day). A time after the date contributes its hours/minutes/seconds.
 */
export function parseDateCell(text: string | null, dayFirst = false): number | null {
  if (text === null) return null;
  const s = text.trim();
  if (s === "") return null;
  // ISO date, with an optional time and offset ("2024-01-16", "2024-01-16T09:30").
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (m) {
    return utcMs(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      m[4] === undefined ? 0 : Number(m[4]),
      m[5] === undefined ? 0 : Number(m[5]),
      m[6] === undefined ? 0 : Number(m[6]),
      m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0")),
    );
  }
  // A bare year is Jan 1 of that year.
  if (/^\d{4}$/.test(s)) return Date.UTC(Number(s), 0, 1);
  // Day + month name + year ("16-Jan-2004", "16 Jan 2004").
  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{4})$/.exec(s);
  if (m) {
    const month = monthFromName(m[2]);
    if (month === null) return null;
    return utcMs(Number(m[3]), month, Number(m[1]));
  }
  // Month name + day + year ("Sep 6, 2024", "September 6 2024").
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m) {
    const month = monthFromName(m[1]);
    if (month === null) return null;
    return utcMs(Number(m[3]), month, Number(m[2]));
  }
  // Slashes ("03/04/2024"): day-first when the preference says so, and a
  // first component over 12 is always the day, either way.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = fullYear(Number(m[3]));
    const day = a > 12 ? a : b > 12 ? b : dayFirst ? a : b;
    const month = a > 12 ? b : b > 12 ? a : dayFirst ? b : a;
    return utcMs(year, month - 1, day);
  }
  return null;
}

/**
 * Read one free-form elapsed-time cell as seconds, or null when it can't be
 * read. Shapes: "h:mm:ss" (hours unbounded, minutes/seconds under 60),
 * "m:ss" (a stopwatch reading), a fractional second on either, and a plain
 * number, which is already seconds. Negative times don't exist here.
 */
export function parseElapsedCell(text: string | null): number | null {
  if (text === null) return null;
  const s = text.trim();
  if (s === "") return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  let m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (m) {
    const minutes = Number(m[2]);
    const seconds = Number(m[3]);
    if (minutes >= 60 || seconds >= 60) return null;
    return Number(m[1]) * 3600 + minutes * 60 + seconds;
  }
  m = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (m) {
    const seconds = Number(m[2]);
    if (seconds >= 60) return null;
    return Number(m[1]) * 60 + seconds;
  }
  return null;
}

/** The earliest parseable date in the column, as ms since the epoch — the default zero. */
export function earliestDateMs(cells: (string | null)[], conversion?: XConversion): number | null {
  let earliest: number | null = null;
  for (const cell of cells) {
    const ms = parseDateCell(cell, conversion?.dayFirst);
    if (ms !== null && (earliest === null || ms < earliest)) earliest = ms;
  }
  return earliest;
}

/**
 * The conversion's zero, as ms since the epoch: the chosen start date when
 * it parses, else the earliest parseable date in the column, else null (no
 * parseable date at all — every cell converts to null anyway).
 */
export function xZeroMs(cells: (string | null)[], conversion?: XConversion): number | null {
  const start = conversion?.startDate === undefined ? null : parseDateCell(conversion.startDate);
  return start ?? earliestDateMs(cells, conversion);
}

/** One date, as a number in the conversion's units, measured from `zeroMs`. */
export function dateToValue(ms: number, conversion: XConversion, zeroMs: number): number {
  return (ms - zeroMs) / 1000 / unitInSeconds(conversion.units);
}

/** One elapsed time, as a number in the conversion's units. */
export function elapsedToValue(seconds: number, conversion: XConversion): number {
  return seconds / unitInSeconds(conversion.units);
}

/**
 * One X cell, as the number the analyses and graphs see — or null when the
 * cell is blank or can't be read (missing). `zeroMs` is the date column's
 * zero from xZeroMs; it is ignored for elapsed X. Numbers X columns never
 * come here — readTable parses those with parseCell, as before.
 */
export function convertXCell(
  cell: string | null,
  format: XColumnFormat,
  conversion: XConversion,
  zeroMs: number | null,
): number | null {
  if (format === "date") {
    const ms = parseDateCell(cell, conversion.dayFirst);
    if (ms === null) return null;
    return dateToValue(ms, conversion, zeroMs ?? ms);
  }
  if (format === "elapsed") {
    const seconds = parseElapsedCell(cell);
    if (seconds === null) return null;
    return elapsedToValue(seconds, conversion);
  }
  return parseCell(cell);
}

/**
 * What the grid shows for one X cell: the typed text when it is blank or
 * reads, "?" when it doesn't. The original text is kept in the cell, so
 * editing a "?" cell starts from what was typed.
 */
export function displayXCell(cell: string | null, format: XColumnFormat, conversion?: XConversion): string {
  if (cell === null || cell === "") return "";
  if (format === "date") return parseDateCell(cell, conversion?.dayFirst) === null ? "?" : cell;
  if (format === "elapsed") return parseElapsedCell(cell) === null ? "?" : cell;
  return cell;
}

/** "16-Jan-2004" — the date shape Prism itself writes in a .pzfx XAdvancedColumn. */
export function formatPrismDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()}-${MONTH_ABBR[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/** "2024-01-16" for a ms value, or undefined for null. */
export function isoDateOf(ms: number | null): string | undefined {
  return ms === null ? undefined : new Date(ms).toISOString().slice(0, 10);
}

/** The Prism spelling of a unit ("Days", "Hours", …) for a .prism dateTimeConversion. */
export function prismUnits(unit: DateUnit): string {
  return `${unit.charAt(0).toUpperCase()}${unit.slice(1)}`;
}

/**
 * A Prism unit string back to a DateUnit, or null when it isn't one.
 * "Months" is null on purpose: Prism has no month unit, so a file claiming
 * one falls back to days (with a warning from the caller).
 */
export function prismUnitsToDateUnit(s: unknown): DateUnit | null {
  if (typeof s !== "string") return null;
  const lower = s.toLowerCase();
  return isDateUnit(lower) ? lower : null;
}

/**
 * A .prism dateTimeConversion ({units, zeroDate}) as an XConversion. A
 * missing or unknown unit is days; an unparseable zero date is dropped
 * (the earliest date in the column becomes the zero instead).
 */
export function prismDateTimeConversion(dateTimeConversion: unknown): XConversion {
  const dtc = dateTimeConversion as { units?: unknown; zeroDate?: unknown } | null | undefined;
  const units = prismUnitsToDateUnit(dtc?.units) ?? "days";
  const startDate =
    typeof dtc?.zeroDate === "string" ? isoDateOf(parseDateCell(dtc.zeroDate)) : undefined;
  return startDate === undefined ? { units } : { units, startDate };
}

/** Two conversions are the same once defaults are filled in. */
export function sameConversion(a: XConversion | undefined, b: XConversion | undefined): boolean {
  const norm = (c: XConversion | undefined) => ({
    units: c?.units ?? "days",
    startDate: c?.startDate,
    dayFirst: c?.dayFirst ?? false,
  });
  const x = norm(a);
  const y = norm(b);
  return x.units === y.units && x.startDate === y.startDate && x.dayFirst === y.dayFirst;
}
