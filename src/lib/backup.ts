// Automatic backup (Plane seq 226, 1.8.0): the settings and identity half.
// The store itself lives in Rust (src-tauri/src/backup.rs); the engine in
// src/store/use-document.ts calls it. The setting is the toggles + the
// interval — the retention (4 days, Prism 10+) is fixed, not user-adjustable.
// The localStorage access mirrors src/lib/prism-nudge.ts and autosave.ts:
// never throws.
import { fileName } from "./paths";

/** Prism 10+: a backup is kept 4 days if the original file was unsaved. */
export const BACKUP_RETENTION_DAYS = 4;

/** Prism's default backup interval: every 10 minutes. */
export const BACKUP_DEFAULT_INTERVAL_MINUTES = 10;
export const BACKUP_MIN_INTERVAL_MINUTES = 1;
export const BACKUP_MAX_INTERVAL_MINUTES = 60;

const BACKUP_ENABLED_KEY = "titer.backup.enabled";
const BACKUP_INTERVAL_KEY = "titer.backup.intervalMinutes";
const BACKUP_SHEET_SWITCH_KEY = "titer.backup.onSheetSwitch";
const UNTITLED_IDS_KEY = "titer.backup.untitledIds";

/** Whether automatic backup is on. Default true when the key is absent; any
 *  stored "false" disables it. Never throws (no localStorage in tests,
 *  private mode, or a quota error all read as "on"). */
export function isBackupEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(BACKUP_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Persist the toggle. Never throws — a setting that can't be stored
 *  doesn't stick, and backup simply keeps its default next launch. */
export function setBackupEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(BACKUP_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore: see above.
  }
}

/** The timer interval in minutes, clamped to 1–60; a missing, non-numeric
 *  or otherwise unreadable value reads as the 10-minute default. Never
 *  throws. */
export function backupIntervalMinutes(): number {
  try {
    if (typeof localStorage === "undefined") return BACKUP_DEFAULT_INTERVAL_MINUTES;
    const raw = localStorage.getItem(BACKUP_INTERVAL_KEY);
    // Absent (or blank) reads as the default — `Number(null)` is 0, which
    // would clamp to the 1-minute minimum instead.
    if (raw === null || raw.trim() === "") return BACKUP_DEFAULT_INTERVAL_MINUTES;
    return clampBackupIntervalMinutes(Number(raw));
  } catch {
    return BACKUP_DEFAULT_INTERVAL_MINUTES;
  }
}

/** Persist the interval (clamped on the way in, so a stored value is
 *  always in range). Never throws. */
export function setBackupIntervalMinutes(minutes: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(BACKUP_INTERVAL_KEY, String(clampBackupIntervalMinutes(minutes)));
  } catch {
    // Ignore: see above.
  }
}

/** Clamp an interval to 1–60 minutes; anything non-numeric falls back to
 *  the 10-minute default. Pure, so checks.ts pins it. */
export function clampBackupIntervalMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return BACKUP_DEFAULT_INTERVAL_MINUTES;
  return Math.min(BACKUP_MAX_INTERVAL_MINUTES, Math.max(BACKUP_MIN_INTERVAL_MINUTES, Math.floor(minutes)));
}

/** Whether a backup is also written when the sheet changes (Prism's second
 *  trigger). Default true when the key is absent. Never throws. */
export function isBackupOnSheetSwitch(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(BACKUP_SHEET_SWITCH_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Persist the sheet-switch toggle. Never throws. */
export function setBackupOnSheetSwitch(enabled: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(BACKUP_SHEET_SWITCH_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore: see above.
  }
}

/** What a backup belongs to: a local file, a cloud file, or an untitled
 *  project (identified by its stable per-window id — see
 *  `untitledBackupId`). One of the three is always set. */
export interface BackupTarget {
  filePath?: string | null;
  remote?: { provider: string; accountId: string; fileId: string; path: string } | null;
  untitledId?: string;
  untitledName?: string;
}

/** The identity the Rust store keys the backup by. Stable for the life of
 *  the project: the same file, cloud file, or untitled window always maps
 *  to the same backup, and two different projects never share one. Pure,
 *  so checks.ts pins it. */
export function backupIdentity(target: BackupTarget): string {
  if (target.filePath) return `file:${target.filePath}`;
  if (target.remote) return `remote:${target.remote.provider}:${target.remote.accountId}:${target.remote.fileId}`;
  return `untitled:${target.untitledId ?? "blank"}`;
}

/** The name the recovery dialog and the MCP list show for a backup: the
 *  file's name (with its extension), or the untitled project's name. Pure,
 *  so checks.ts pins it. */
export function backupDisplayName(target: BackupTarget): string {
  if (target.filePath) return fileName(target.filePath);
  if (target.remote) return fileName(target.remote.path);
  return target.untitledName ?? "Untitled";
}

/** An untitled project's stable id, one per window label ("project-1",
 *  "project-2"…): minted once, kept in localStorage, so a backup written
 *  before a crash is found again by the window that reopens under the same
 *  label. Without storage (Node tests) the id still holds for the session.
 *  Prism 10+ Windows skips files that were never saved; Titer backs them
 *  up anyway — the 1.7.3 autosave's own comment says crash recovery for
 *  untitled work is seq 226, and an untitled project is exactly the work
 *  with no file to lose it to. */
export function untitledBackupId(windowLabel: string): string {
  const ids = readUntitledIds();
  const existing = ids[windowLabel];
  if (existing) return existing;
  const minted = randomId();
  ids[windowLabel] = minted;
  writeUntitledIds(ids);
  return minted;
}

/** Forget a window label's untitled id, so the next untitled project in
 *  that window mints a fresh one. */
export function clearUntitledBackupId(windowLabel: string): void {
  const ids = readUntitledIds();
  if (!(windowLabel in ids)) return;
  delete ids[windowLabel];
  writeUntitledIds(ids);
}

function readUntitledIds(): Record<string, string> {
  try {
    if (typeof localStorage === "undefined") return untitledIdsMemory;
    const raw = localStorage.getItem(UNTITLED_IDS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([k, v]) => typeof k === "string" && typeof v === "string"),
    );
  } catch {
    return {};
  }
}

function writeUntitledIds(ids: Record<string, string>): void {
  try {
    if (typeof localStorage === "undefined") {
      untitledIdsMemory = ids;
      return;
    }
    localStorage.setItem(UNTITLED_IDS_KEY, JSON.stringify(ids));
  } catch {
    // Ignore: the id still holds for this session via the returned value.
  }
}

/** The no-storage fallback for `readUntitledIds` / `writeUntitledIds`:
 *  without localStorage the ids live in module memory, so they still hold
 *  for the session (and the tests). */
let untitledIdsMemory: Record<string, string> = {};

function randomId(): string {
  try {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return Math.random().toString(16).slice(2, 14);
  }
}

/** Whether a backup written at `savedAtMs` should be offered over a saved
 *  file last written at `sourceMtimeMs` (null: untitled, or a cloud file
 *  with no local mtime — always offered). A backup that is NOT newer than
 *  the file is dropped silently: restoring it would regress the file. The
 *  engine also rewrites the backup on every save, so a backup is never
 *  older than its file unless the file changed somewhere else. Pure, so
 *  checks.ts pins it. */
export function backupIsNewerThanSource(savedAtMs: number, sourceMtimeMs: number | null): boolean {
  return sourceMtimeMs === null || savedAtMs > sourceMtimeMs;
}
