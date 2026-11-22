// Recently-used analyses: the last analysis types run (any table), newest
// first — Prism's Analyze dialog lists them at the top, and Titer's New
// Analysis picker does the same (seq 298). App-wide in app config (local
// storage): recency is a user habit, not project data, so it never touches
// the project file. The picker records a run on wizard completion (and on a
// direct run, which is the same pick with nothing to ask).
import { ANALYSIS_OPTIONS_BY_TABLE, analysisLabel } from "../views/analyses";
import type { AnalysisPickerValue } from "../stats/types";

const KEY = "titer.recent-analyses";
export const MAX_RECENT_ANALYSES = 5;

/** One recent analysis: its picker value, the name the picker showed, and when it ran. */
export type RecentAnalysisEntry = { type: AnalysisPickerValue; label: string; at: number };

/** The picker values the app knows: every option on every table type. */
const KNOWN_TYPES = new Set<string>(
  Object.values(ANALYSIS_OPTIONS_BY_TABLE).flatMap((options) => options.map((o) => o.value)),
);

/** Parses a stored list: well-formed entries for known tests as-is, anything
 *  else left out. Pure, so checks.ts pins it. */
export function parseRecentAnalyses(raw: unknown): RecentAnalysisEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: RecentAnalysisEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Partial<RecentAnalysisEntry>;
    if (typeof entry.type !== "string" || !KNOWN_TYPES.has(entry.type)) continue;
    if (typeof entry.label !== "string" || entry.label === "") continue;
    if (typeof entry.at !== "number" || !Number.isFinite(entry.at)) continue;
    entries.push({ type: entry.type as AnalysisPickerValue, label: entry.label, at: entry.at });
  }
  return entries.slice(0, MAX_RECENT_ANALYSES);
}

/** The list kept. */
export function loadRecentAnalyses(): RecentAnalysisEntry[] {
  try {
    if (typeof localStorage === "undefined") return [];
    return parseRecentAnalyses(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function saveRecentAnalyses(entries: RecentAnalysisEntry[]) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Not kept: this window's list still shows it.
  }
}

/** Records a run: the type moves to the front (no duplicates), the list caps
 *  at 5. Returns the kept list. */
export function recordRecentAnalysis(value: AnalysisPickerValue, at: number = Date.now()): RecentAnalysisEntry[] {
  const entries = loadRecentAnalyses().filter((e) => e.type !== value);
  entries.unshift({ type: value, label: analysisLabel(value), at });
  const kept = entries.slice(0, MAX_RECENT_ANALYSES);
  saveRecentAnalyses(kept);
  return kept;
}

/** Empties the list. */
export function clearRecentAnalyses() {
  saveRecentAnalyses([]);
}
