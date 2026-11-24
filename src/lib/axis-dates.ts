// Date / elapsed scales for an XY graph's X axis (Prism 11, seq 332 part D).
//
// Half A converts a date/elapsed X column to numbers (units + start date);
// this module turns those numbers back into axis labels. A date axis shows
// calendar dates with smart spacing (the step that lands nearest five ticks,
// aligned to hour / midnight / Monday / the 1st / Jan 1); an elapsed axis
// shows durations as h / h:mm / h:mm:ss / h:mm:ss.ms on "nice" steps. All
// dates are UTC — a date has no timezone (date-time.ts).

import { formatPrismDate, unitInSeconds, type XConversion } from "./date-time";

/** The date display formats the Format Axes dialog offers (Prism's Date scale).
 *  Stored lowercase — `readOptions` lowercases every choice value on read, so
 *  a mixed-case key would never survive a file round-trip; the panel shows
 *  the proper-cased label for each key. */
export const DATE_DISPLAY_FORMATS = [
  "16-jan-2004",
  "jan 16, 2004",
  "2024-01-16",
  "16 jan 2004",
  "jan 2004",
  "2004",
  "16-jan",
  "01/16/2004",
] as const;
export type DateDisplayFormat = (typeof DATE_DISPLAY_FORMATS)[number];
export const isDateDisplayFormat = (v: unknown): v is DateDisplayFormat =>
  typeof v === "string" && (DATE_DISPLAY_FORMATS as readonly string[]).includes(v);
/** Prism's own date shape (also what .pzfx writes) — the default. */
export const DEFAULT_DATE_DISPLAY_FORMAT: DateDisplayFormat = "16-jan-2004";
/** The panel label for each stored key. */
export const DATE_DISPLAY_FORMAT_LABELS: Record<DateDisplayFormat, string> = {
  "16-jan-2004": "16-Jan-2004",
  "jan 16, 2004": "Jan 16, 2004",
  "2024-01-16": "2024-01-16",
  "16 jan 2004": "16 Jan 2004",
  "jan 2004": "Jan 2004",
  "2004": "2004",
  "16-jan": "16-Jan",
  "01/16/2004": "01/16/2004",
};

/** The elapsed display formats (Prism's Elapsed Time scale). */
export const ELAPSED_DISPLAY_FORMATS = ["h", "h:mm", "h:mm:ss", "h:mm:ss.ms"] as const;
export type ElapsedDisplayFormat = (typeof ELAPSED_DISPLAY_FORMATS)[number];
export const isElapsedDisplayFormat = (v: unknown): v is ElapsedDisplayFormat =>
  typeof v === "string" && (ELAPSED_DISPLAY_FORMATS as readonly string[]).includes(v);
export const DEFAULT_ELAPSED_DISPLAY_FORMAT: ElapsedDisplayFormat = "h:mm:ss";
/** The panel label for each stored key. */
export const ELAPSED_DISPLAY_FORMAT_LABELS: Record<ElapsedDisplayFormat, string> = {
  h: "Hours",
  "h:mm": "h:mm",
  "h:mm:ss": "h:mm:ss",
  "h:mm:ss.ms": "h:mm:ss.ms",
};

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

/** One date, as a tick label in the chosen display format (UTC). */
export function formatDateTick(ms: number, format: DateDisplayFormat): string {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const month = MONTH_ABBR[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  switch (format) {
    case "16-jan-2004":
      return formatPrismDate(ms);
    case "jan 16, 2004":
      return `${month} ${day}, ${year}`;
    case "2024-01-16":
      return `${year}-${pad2(d.getUTCMonth() + 1)}-${pad2(day)}`;
    case "16 jan 2004":
      return `${day} ${month} ${year}`;
    case "jan 2004":
      return `${month} ${year}`;
    case "2004":
      return `${year}`;
    case "16-jan":
      return `${day}-${month}`;
    case "01/16/2004":
      return `${pad2(d.getUTCMonth() + 1)}/${pad2(day)}/${year}`;
  }
}

/** One elapsed time, as a tick label in the chosen display format. `seconds`
 *  is a duration, never a clock time — "h" is hours with up to 2 decimals. */
export function formatElapsedTick(seconds: number, format: ElapsedDisplayFormat): string {
  const totalMs = Math.round(seconds * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  switch (format) {
    case "h": {
      const hours = seconds / 3600;
      return Number.isInteger(hours) ? String(hours) : String(Number(hours.toFixed(2)));
    }
    case "h:mm":
      return `${h}:${pad2(m)}`;
    case "h:mm:ss":
      return `${h}:${pad2(m)}:${pad2(s)}`;
    case "h:mm:ss.ms":
      return `${h}:${pad2(m)}:${pad2(s)}.${String(ms).padStart(3, "0")}`;
  }
}

/** The tick count a readable axis aims at: the step whose count lands
 *  nearest it wins, so a 3-hour span steps hourly (4 ticks) rather than
 *  half-hourly (7) and a 10-day span steps 2 days (6) rather than daily (11). */
const TARGET_TICKS = 5;
/** No more ticks than this, however the span falls. */
const MAX_TICKS = 8;

function alignDown(ms: number, align: "hour" | "day" | "week"): number {
  const d = new Date(ms);
  if (align === "hour") return ms - (ms % MS_PER_HOUR);
  if (align === "day") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  // Monday: getUTCDay() is 0 on Sunday, so (day + 6) % 7 counts from Monday.
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday);
}

type DateStep = { kind: "fixed"; ms: number; align: "hour" | "day" | "week" } | { kind: "months"; months: number };

const DATE_STEPS: DateStep[] = [
  { kind: "fixed", ms: 15 * 60 * 1000, align: "hour" },
  { kind: "fixed", ms: 30 * 60 * 1000, align: "hour" },
  { kind: "fixed", ms: MS_PER_HOUR, align: "hour" },
  { kind: "fixed", ms: 3 * MS_PER_HOUR, align: "hour" },
  { kind: "fixed", ms: 6 * MS_PER_HOUR, align: "hour" },
  { kind: "fixed", ms: 12 * MS_PER_HOUR, align: "hour" },
  { kind: "fixed", ms: MS_PER_DAY, align: "day" },
  { kind: "fixed", ms: 2 * MS_PER_DAY, align: "day" },
  { kind: "fixed", ms: 7 * MS_PER_DAY, align: "week" },
  { kind: "fixed", ms: 14 * MS_PER_DAY, align: "week" },
  { kind: "months", months: 1 },
  { kind: "months", months: 3 },
  { kind: "months", months: 6 },
  { kind: "months", months: 12 },
  { kind: "months", months: 24 },
  { kind: "months", months: 60 },
  { kind: "months", months: 120 },
];

/** The 1st of the month `months` ahead of (`year`, `month`). */
function addMonths(year: number, month: number, months: number): number {
  const total = year * 12 + month + months;
  return Date.UTC(Math.floor(total / 12), total % 12, 1);
}

/** The ticks one step puts in [lo, hi]: aligned to the step's boundary, and
 *  at most MAX_TICKS long — longer runs stop early (the step doesn't fit). */
function dateTicksForStep(lo: number, hi: number, step: DateStep): number[] {
  const ticks: number[] = [];
  if (step.kind === "fixed") {
    let t = alignDown(lo, step.align);
    while (t < lo) t += step.ms;
    while (t <= hi && ticks.length <= MAX_TICKS) {
      ticks.push(t);
      t += step.ms;
    }
    return ticks;
  }
  const d = new Date(lo);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  while (t < lo) {
    const nd = new Date(t);
    t = addMonths(nd.getUTCFullYear(), nd.getUTCMonth(), step.months);
  }
  while (t <= hi && ticks.length <= MAX_TICKS) {
    ticks.push(t);
    const nd = new Date(t);
    t = addMonths(nd.getUTCFullYear(), nd.getUTCMonth(), step.months);
  }
  return ticks;
}

/**
 * Smart-spaced date ticks (ms since the epoch) across [loMs, hiMs]: the
 * smallest step whose count fits, nearest the five-tick aim. A degenerate
 * range (one date) yields that date alone; a reversed range is read the
 * right way round.
 */
export function dateAxisTicks(loMs: number, hiMs: number): number[] {
  const [lo, hi] = loMs <= hiMs ? [loMs, hiMs] : [hiMs, loMs];
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo === hi) return [lo];
  let best: number[] | null = null;
  let bestScore = Infinity;
  for (const step of DATE_STEPS) {
    const ticks = dateTicksForStep(lo, hi, step);
    if (ticks.length > MAX_TICKS || ticks.length === 0) continue;
    const score = Math.abs(ticks.length - TARGET_TICKS);
    if (score < bestScore) {
      best = ticks;
      bestScore = score;
      if (score === 0) break;
    }
  }
  // No step fit (a span wider than the ladder): the widest step's ticks.
  return best ?? dateTicksForStep(lo, hi, DATE_STEPS[DATE_STEPS.length - 1]);
}

/** "Nice" elapsed steps, in seconds: 1/2/5/10/15/30 s, then minutes, hours, days, weeks. */
const ELAPSED_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400, 172800, 604800];

function elapsedTicksForStep(lo: number, hi: number, step: number): number[] {
  const ticks: number[] = [];
  let t = Math.ceil(lo / step) * step;
  // -0 is 0 for the axis: a tick at exactly 0 reads "0", not "-0".
  if (t === 0) t = 0;
  while (t <= hi && ticks.length <= MAX_TICKS) {
    ticks.push(t);
    t += step;
  }
  return ticks;
}

/**
 * Smart-spaced elapsed ticks (seconds) across [loSec, hiSec]: the same
 * five-tick aim as the date scale. A degenerate range yields that value alone.
 */
export function elapsedAxisTicks(loSec: number, hiSec: number): number[] {
  const [lo, hi] = loSec <= hiSec ? [loSec, hiSec] : [hiSec, loSec];
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo === hi) return [lo];
  let best: number[] | null = null;
  let bestScore = Infinity;
  for (const step of ELAPSED_STEPS) {
    const ticks = elapsedTicksForStep(lo, hi, step);
    if (ticks.length > MAX_TICKS || ticks.length === 0) continue;
    const score = Math.abs(ticks.length - TARGET_TICKS);
    if (score < bestScore) {
      best = ticks;
      bestScore = score;
      if (score === 0) break;
    }
  }
  return best ?? elapsedTicksForStep(lo, hi, ELAPSED_STEPS[ELAPSED_STEPS.length - 1]);
}

/** A numeric axis value (in the conversion's units) as ms since the epoch. */
export function valueToMs(value: number, conversion: XConversion, zeroMs: number): number {
  return zeroMs + value * unitInSeconds(conversion.units) * 1000;
}

/** Ms since the epoch back to a numeric axis value in the conversion's units. */
export function msToValue(ms: number, conversion: XConversion, zeroMs: number): number {
  return (ms - zeroMs) / 1000 / unitInSeconds(conversion.units);
}

/**
 * A date axis's ticks for a numeric range [lo, hi] in the conversion's
 * units: `tickvals` in those units (what Plotly plots at), `ticktext` the
 * formatted dates. `zeroMs` is the conversion's zero from xZeroMs.
 */
export function dateAxisTicksForValues(
  lo: number,
  hi: number,
  conversion: XConversion,
  zeroMs: number,
  display: DateDisplayFormat,
): { tickvals: number[]; ticktext: string[] } {
  const ticks = dateAxisTicks(valueToMs(lo, conversion, zeroMs), valueToMs(hi, conversion, zeroMs));
  return {
    tickvals: ticks.map((ms) => msToValue(ms, conversion, zeroMs)),
    ticktext: ticks.map((ms) => formatDateTick(ms, display)),
  };
}

/**
 * An elapsed axis's ticks for a numeric range [lo, hi] in the conversion's
 * units: `tickvals` in those units, `ticktext` the formatted durations.
 */
export function elapsedAxisTicksForValues(
  lo: number,
  hi: number,
  conversion: XConversion,
  display: ElapsedDisplayFormat,
): { tickvals: number[]; ticktext: string[] } {
  const toSeconds = (v: number) => v * unitInSeconds(conversion.units);
  const ticks = elapsedAxisTicks(toSeconds(lo), toSeconds(hi));
  return {
    tickvals: ticks.map((s) => s / unitInSeconds(conversion.units)),
    ticktext: ticks.map((s) => formatElapsedTick(s, display)),
  };
}
