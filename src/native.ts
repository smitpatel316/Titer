// The only module that talks to the native shell (Tauri): dialogs, files, the R engine,
// the window, the project windows and what they open, and the menus. Everything else in
// the app is plain web code.
import { invoke } from "@tauri-apps/api/core";
import { join, tempDir } from "@tauri-apps/api/path";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { WebviewWindow, getCurrentWebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { getVersion, setTheme as setAppTheme } from "@tauri-apps/api/app";
import { Image } from "@tauri-apps/api/image";
import { Menu, Submenu, type MenuOptions } from "@tauri-apps/api/menu";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import type { RVector } from "./stats/webr";
import { cancelActiveEvals, interruptR, resetR, type EngineBootStatus } from "./stats/webr";
import { keynoteSizePoints } from "./lib/office-export";
import { isMacOs } from "./lib/channel";
import {
  createEvalQueue,
  setRQueueSnapshot,
  type RQueueSnapshot,
} from "./stats/r-queue";
import type {
  CloudAccount,
  CloudStatus,
  ProviderId,
  RemoteDownload,
  RemoteEntry,
  RemoteVersion,
} from "./lib/cloud";

/** False when the UI runs in a plain browser (`npm run web`, for development) or in the tests. */
export const isNative = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** True on macOS (the Mac-only menu items, like Close All, hang off this). */
export const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform ?? navigator.userAgent ?? "");

const win = () => getCurrentWindow();

// ── Dialogs ────────────────────────────────────────────────────────────

/** Native alert: `title` in bold, `detail` below it. */
export async function alert(title: string, detail = "", kind: "info" | "warning" | "error" = "warning") {
  if (isNative) await message(detail, { title, kind });
  else window.alert(`${title}\n\n${detail}`);
}

/** The Save / Don't Save / Cancel prompt shown before unsaved work is discarded. */
export async function askToSave(): Promise<"save" | "discard" | "cancel"> {
  const answer = await message("Your changes will be lost if you don't save them.", {
    title: "Do you want to save the changes you made to your project?",
    kind: "warning",
    buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" },
  });
  if (answer === "Save" || answer === "Yes") return "save";
  if (answer === "Don't Save" || answer === "No") return "discard";
  return "cancel";
}

/** A Delete / Cancel confirmation. */
export async function confirmDelete(title: string, detail: string): Promise<boolean> {
  if (!isNative) return window.confirm(`${title}\n\n${detail}`);
  const answer = await message(detail, { title, kind: "warning", buttons: { ok: "Delete", cancel: "Cancel" } });
  return answer === "Delete" || answer === "Ok";
}

/** A Revert / Cancel confirmation for File ▸ Revert to Saved (seq 306):
 *  the caller passes the title and detail — the plain confirm's wording,
 *  or the externally-changed file's, from src/lib/revert.ts. */
export async function confirmRevert(title: string, detail: string): Promise<boolean> {
  if (!isNative) return window.confirm(`${title}\n\n${detail}`);
  const answer = await message(detail, { title, kind: "warning", buttons: { ok: "Revert", cancel: "Cancel" } });
  return answer === "Revert" || answer === "Ok";
}

/** A Replace / Cancel confirmation for a drag-and-drop onto an occupied
 *  figure panel (seq 307): the caller passes the title and detail — the
 *  drop plan's, from src/lib/figure.ts. */
export async function confirmReplace(title: string, detail: string): Promise<boolean> {
  if (!isNative) return window.confirm(`${title}\n\n${detail}`);
  const answer = await message(detail, { title, kind: "warning", buttons: { ok: "Replace", cancel: "Cancel" } });
  return answer === "Replace" || answer === "Ok";
}

/** An Update Now / Later prompt for a newer version of Titer. `forced`:
 *  no Later — the channel says this version must not run, so the dialog
 *  has only Update Now. `installable`: false on a platform with no
 *  installable asset (Linux today) — the prompt then offers the manual
 *  download instead of promising a restart-to-install. */
export async function askToUpdate(version: string, forced: boolean, installable: boolean): Promise<boolean> {
  const detail = !installable
    ? "Download it from GitHub, then replace Titer in your Applications folder."
    : forced
      ? "This version can no longer run — update to keep using Titer."
      : "Download it now, and Titer will restart to install it.";
  const answer = await message(detail, {
    title: `Titer ${version} is available`,
    kind: "info",
    buttons: forced ? { ok: "Update Now" } : { ok: "Update Now", cancel: "Later" },
  });
  return answer === "Update Now" || answer === "Ok";
}

/** A Retry / Quit prompt when a forced update cannot install. */
export async function askToRetryUpdate(version: string, detail: string): Promise<boolean> {
  const answer = await message(`Titer ${version} could not be installed: ${detail}`, {
    title: "Couldn't Install the Update",
    kind: "warning",
    buttons: { ok: "Retry", cancel: "Quit" },
  });
  return answer === "Retry" || answer === "Ok";
}

/** This app's version ("1.0.0"), from its bundle. */
export const appVersion = getVersion;

/** `defaultPath` may be a bare file name; the panel then picks the folder.
 *  GTK's save panel does not append the filter extension when the user edits
 *  the Name field directly (it only does so via the location bar), and the
 *  shell refuses extensionless writes — so the extension is ensured here, for
 *  every caller, rather than trusting the dialog to return one. */
export async function pickSavePath(title: string, defaultPath: string, name: string, ext: string) {
  const path = await save({ title, defaultPath, filters: [{ name, extensions: [ext] }] });
  return path === null ? null : ensureSaveExtension(path, ext);
}

/** The extensions `write_file` accepts — mirror of `WRITE_FILE_EXTENSIONS`
 *  in src-tauri/src/main.rs; keep in step. A trailing dot-segment outside
 *  this list is not an extension the shell will write. */
const WRITABLE_EXTENSIONS = new Set([
  "hlx", "prism", "pzt", "pzm", "pzfx", "png", "jpg", "jpeg", "svg", "pdf",
  "tif", "tiff", "bmp", "eps", "csv", "txt", "xlsx", "xml", "docx", "pptx",
]);

/** The path a save dialog returned, with the format extension ensured: an
 *  extensionless name gets `.${ext}` (a trailing dot is stripped first, so
 *  "figure." becomes "figure.png", not "figure..png"). A name that already
 *  ends in a recognized extension is left alone — the target extension
 *  itself, or any extension `write_file` accepts, so a user who typed
 *  "figure.jpg" for a PNG export keeps what they typed and a Keynote
 *  ".key" path is not doubled. A trailing dot-segment that is neither
 *  ("Fig 1.2", whose "2" is no extension) gains `.${ext}`. Dots in a
 *  folder name are not an extension, and the basename is split on both
 *  "/" and "\\", so a dot in a Windows parent directory is not mistaken
 *  for the file's extension. */
export function ensureSaveExtension(path: string, ext: string): string {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  const suffix = dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : "";
  if (suffix !== "" && (suffix === ext.toLowerCase() || WRITABLE_EXTENSIONS.has(suffix))) return path;
  return `${path.replace(/\.+$/, "")}.${ext}`;
}

/** A folder picker (File ▸ Move To…): the native dialog, starting in the
 *  given folder. Null when the user cancels. */
export async function pickFolder(title: string, defaultPath: string) {
  return open({ title, defaultPath, directory: true, multiple: false });
}

/** Moves a file on disk (File ▸ Rename… / Move To…): the shell refuses a
 *  collision and a missing source — see `move_file` in main.rs. */
export const moveFile = (from: string, to: string) => invoke<void>("move_file", { from, to });

// ── Files ──────────────────────────────────────────────────────────────

export const readText = (path: string) => invoke<string>("read_text", { path });

/** Atomic write (temp file + rename). Bytes go as a raw body, not JSON. */
export function writeFile(path: string, data: string | Uint8Array) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return invoke("write_file", bytes, { headers: { path: encodeURIComponent(path) } });
}

/** Runs the Keynote handoff in the shell (`send_to_keynote` in
 *  main.rs): the shell builds the AppleScript itself from these values —
 *  the page never hands it a script string — Keynote makes the
 *  presentation and saves the .key at `path`. The shell deletes the temp
 *  PNG once osascript finishes; macOS-only — the shell refuses
 *  anywhere else. */
export const sendToKeynote = (pngPath: string, path: string, title: string, widthPt: number, heightPt: number) =>
  invoke<string>("send_to_keynote", { pngPath, path, title, widthPt, heightPt });

/** Hands a PNG to Keynote on macOS (seq 217): the PNG goes to a temp
 *  file, and the shell builds the AppleScript for it and runs it in
 *  Keynote, which saves the real .key at `outPath` and stays open on it,
 *  as Prism leaves it. Returns the .key path. Throws on non-macOS — the
 *  menu hides the item there, and the MCP tool refuses the target there
 *  first. */
export async function handoffPngToKeynote(
  png: Uint8Array,
  title: string,
  outPath: string,
  widthPx: number,
  heightPx: number,
  dpi: number,
): Promise<string> {
  if (!isMacOs()) throw new Error("Send to Keynote needs macOS with Keynote installed.");
  const tmp = await tempDir();
  const pngPath = await join(tmp, `titer-keynote-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await writeFile(pngPath, png);
  const { widthPt, heightPt } = keynoteSizePoints(widthPx, heightPx, dpi);
  return sendToKeynote(pngPath, outPath, title, widthPt, heightPt);
}

/** Hands a PNG to the system clipboard on macOS (seq 296): the PNG goes
 *  to a temp file, and the shell puts it on the pasteboard via osascript
 *  (`copy_png_to_clipboard` in main.rs) — the webview's
 *  `navigator.clipboard.write` refuses without a user gesture, and the
 *  MCP copy path has no gesture. The shell deletes the temp PNG and its
 *  script file once osascript finishes. Throws on non-macOS. */
export async function copyPngToClipboard(png: Uint8Array): Promise<void> {
  if (!isMacOs()) throw new Error("Copying a graph image to the clipboard needs macOS.");
  const tmp = await tempDir();
  const pngPath = await join(tmp, `titer-clipboard-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await writeFile(pngPath, png);
  await invoke<void>("copy_png_to_clipboard", { pngPath });
}

/** Hands a vector PDF plus its PNG fallback to the system clipboard on
 *  macOS (seq 446, seq 457; BUG-REPORT #68/#75): both go to temp files,
 *  and the shell puts them on the pasteboard as ONE multi-flavour item
 *  via JavaScript for Automation (`copy_pdf_to_clipboard` in main.rs) — the webview's
 *  `ClipboardItem.supports("application/pdf")` is false on Mac WebKit,
 *  so the web path can never write the PDF item. The shell deletes both
 *  temp files and its script file once osascript finishes. Throws on
 *  non-macOS. */
export async function copyPdfToClipboard(pdf: Uint8Array, png: Uint8Array): Promise<void> {
  if (!isMacOs()) throw new Error("Copying a vector PDF to the clipboard needs macOS.");
  const tmp = await tempDir();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pdfPath = await join(tmp, `titer-clipboard-${stamp}.pdf`);
  const pngPath = await join(tmp, `titer-clipboard-${stamp}.png`);
  await writeFile(pdfPath, pdf);
  await writeFile(pngPath, png);
  await invoke<void>("copy_pdf_to_clipboard", { pdfPath, pngPath });
}

/** Reads the clipboard's text and HTML forms natively on macOS (seq 439):
 *  `pbpaste` for the plain text, `pbpaste -Prefer html` for the HTML table
 *  (`read_clipboard_formats` in main.rs). Paste Special's menu-bar entry
 *  carries no page activation, so the webview's `navigator.clipboard.read()`
 *  can never succeed from it — the shell read is the only path that works
 *  there. Returns null when the clipboard holds neither form. Throws on
 *  non-macOS, where the caller falls back to the webview read. */
export async function readClipboardFormats(): Promise<{ text: string; html: string | null } | null> {
  if (!isMacOs()) throw new Error("Reading the clipboard this way needs macOS.");
  const clip = await invoke<{ text: string | null; html: string | null }>("read_clipboard_formats");
  if (clip.text === null && clip.html === null) return null;
  return { text: clip.text ?? "", html: clip.html };
}

/** My Palettes' file in Titer's data folder: its text ("" before the first), and a new one. */
export const readMyPalettes = () => invoke<string>("read_my_palettes");
export const writeMyPalettes = (text: string) => invoke("write_my_palettes", { text });

// ── Automatic backup (Plane seq 226, 1.8.0) ─────────────────────────────
// The separate-copy store in src-tauri/src/backup.rs: one `.hlx` snapshot
// per project, in Titer's data folder. The engine in
// src/store/use-document.ts calls these; nothing else should.

/** One backup, as the shell lists it. `saved_at_ms` is when the snapshot
 *  was written; `source_mtime_ms` is when the project file itself was last
 *  written (null for untitled and cloud projects). */
export interface BackupEntry {
  key: string;
  display_name: string;
  source_path: string | null;
  saved_at_ms: number;
  source_mtime_ms: number | null;
  size_bytes: number;
}

/** Writes (or overwrites) this project's backup snapshot. `base64` is the
 *  `.hlx` serialization of the current project. */
export const backupWrite = (identity: string, displayName: string, sourcePath: string | null, base64: string) =>
  invoke<BackupEntry>("backup_write", { identity, displayName, sourcePath, base64 });
/** The backups on disk, newest first (stale and incomplete ones pruned). */
export const backupList = () => invoke<BackupEntry[]>("backup_list");
/** The backup for one project identity, if it has one within the keep. */
export const backupStatus = (identity: string) => invoke<BackupEntry | null>("backup_status", { identity });
/** One backup's snapshot bytes, as base64, for restoring. */
export const backupRead = (key: string) => invoke<string>("backup_read", { key });
/** Deletes a project's backup. Missing is fine. */
export const backupDelete = (key: string) => invoke<void>("backup_delete", { key });

// ── AI connections (v3 Phase 1: the in-process MCP server) ─────────────
// The server is off by default and starts only from Settings → AI
// connections. These are the app's own commands — no MCP tool can call
// them, so an agent can never change the safety settings (roadmap §3).

/** Whether the server is on, where it listens, and whether a token exists. */
export interface McpStatus {
  enabled: boolean;
  running: boolean;
  port: number | null;
  endpoint: string | null;
  has_token: boolean;
}

export const mcpStatus = () => invoke<McpStatus>("mcp_status");
export const mcpSetEnabled = (enabled: boolean) => invoke<McpStatus>("mcp_set_enabled", { enabled });

/** What connecting to Antigravity did: `connected` (entry written) or
 *  `already_connected` (the entry was already there — nothing touched). */
export interface McpAntigravityConnect {
  outcome: "connected" | "already_connected";
  command: string;
  config_path: string;
}

/** One-click Antigravity setup: turns the MCP server on (persisted opt-in)
 *  and writes the stdio `titer` entry into ~/.gemini/config/mcp_config.json.
 *  No token anywhere — the bridge reads it from Titer's own connection file. */
export const mcpConnectAntigravity = () => invoke<McpAntigravityConnect>("mcp_connect_antigravity");
/** Brings Antigravity forward (macOS) so the user can Refresh its MCP servers. */
export const mcpOpenAntigravity = () => invoke<void>("mcp_open_antigravity");
/** The local bearer token, for Settings to show (never for an agent). */
export const mcpToken = () => invoke<string>("mcp_token");
/** Rotates the token; only while the server is stopped. */
export const mcpRegenerateToken = () => invoke<string>("mcp_regenerate_token");
/** The `claude mcp add …` command for Claude Code, for Settings to copy. */
export const mcpClaudeCodeCommand = () => invoke<string>("mcp_claude_code_command");
/** The Activity log's last lines (newest last). */
export const mcpActivity = (limit: number) => invoke<string[]>("mcp_activity", { limit });

/** One feedback report saved by `titer_send_feedback`, as Settings lists it. */
export interface FeedbackEntry {
  feedback_id: string;
  ts: number;
  kind: string;
  summary: string;
  details: string;
  context: {
    app_version?: string;
    os?: string;
    failed_tool?: string;
    project_file?: string;
    recent_activity?: { ts?: number; tool: string; ok?: boolean }[];
  };
}

/** The saved feedback entries (newest first). */
export const mcpFeedback = () => invoke<FeedbackEntry[]>("mcp_feedback");

/** One allowlist group as Settings shows it, with its current on/off state. */
export interface McpAllowlistGroup {
  id: string;
  label: string;
  description: string;
  tools: string[];
  enabled: boolean;
}

/** The tool-allowlist groups (contract §12) with their current on/off state. */
export const mcpAllowlist = () => invoke<McpAllowlistGroup[]>("mcp_allowlist");

/** Records the enabled allowlist groups (Settings → AI Connections).
 *  Takes effect immediately — connected AI apps get
 *  `notifications/tools/list_changed` and the Antigravity entry is
 *  re-applied; no reconnect needed. Returns the groups now in effect. */
export const mcpSetAllowlist = (groups: string[]) =>
  invoke<McpAllowlistGroup[]>("mcp_set_allowlist", { groups });

/** The user's feedback-sharing choice, if they have made one: `true` Share,
 *  `false` Don't share, `null` never asked (fresh install or upgrade — the
 *  first-run prompt shows). Lives in the app-data `mcp/` folder, so it
 *  survives restarts and the MCP server reads the same record. */
export const mcpFeedbackConsent = () => invoke<boolean | null>("mcp_feedback_consent");

/** Records the user's feedback-sharing choice (first-run prompt, or the
 *  Settings toggle). Returns the choice now in effect. */
export const mcpSetFeedbackConsent = (sharing: boolean) =>
  invoke<boolean | null>("mcp_set_feedback_consent", { sharing });

/** One captured error, as stored in the local error log (seq 452) and
 *  shown in Settings. `sent` says whether it went to the Titer team
 *  through the feedback channel (only when error-report sharing is on). */
export interface ErrorLogEntry {
  error_id: string;
  ts: number;
  kind: string;
  error_type: string;
  message: string;
  stack: string;
  action: string;
  app_version?: string;
  os?: string;
  sent: boolean;
}

/** The saved error-log entries (newest first). */
export const mcpErrorLog = () => invoke<ErrorLogEntry[]>("mcp_error_log");

/** The user's error-report-sharing choice, if they have made one: `true`
 *  Share, `false` Don't share, `null` never asked. Separate record from
 *  feedback sharing — sharing feedback does not imply sharing error
 *  reports. Lives in the app-data `mcp/` folder beside the feedback
 *  consent record. */
export const mcpErrorLogConsent = () => invoke<boolean | null>("mcp_error_log_consent");

/** Records the user's error-report-sharing choice (first-run prompt, or
 *  the Settings toggle). Returns the choice now in effect. */
export const mcpSetErrorLogConsent = (sharing: boolean) =>
  invoke<boolean | null>("mcp_set_error_log_consent", { sharing });

/** Report one captured error to the shell: scrubbed, appended to the
 *  local rotating log, and — only when error-report sharing is on — sent
 *  through the feedback channel. Returns what happened to it. */
export const mcpLogError = (entry: {
  kind: string;
  error_type: string;
  message: string;
  stack: string;
  action: string;
}) =>
  invoke<{ error_id: string; received: boolean; sent: boolean; sharing: string }>("mcp_log_error", entry);

/** Send unsent error-log entries (e.g. from a previous run's crash) now
 *  that the app is up — only when error-report sharing is on, a few at a
 *  time. Returns how many were considered, sent, deduplicated (an
 *  identical error already reached the team), and left failed. */
export const mcpFlushErrorLog = () =>
  invoke<{ flushed: number; sent: number; duplicates: number; failed: number; sharing: string }>("mcp_flush_error_log");

/** This window's project, for the MCP server to serve. Published on every
 *  revision change (debounced, see store/mcp-publish.ts). A no-op where
 *  there is no native shell (web preview, tests). */
export function mcpPublishSnapshot(snapshot: unknown) {
  if (!isNative) return Promise.resolve();
  return invoke("mcp_publish_snapshot", { snapshot });
}

/** An analysis outcome computed in-session, for `titer_read_results`. */
export function mcpPublishResult(analysisId: string, outcome: unknown) {
  if (!isNative) return Promise.resolve();
  return invoke("mcp_publish_result", { analysisId, outcome });
}

// ── Job queue (L0, GAP-1: the Rust→frontend dispatch channel) ───────────
// Rust enqueues a job and wakes this window with an `mcp-run-job` event;
// the dispatcher (src/store/mcp-dispatch.ts) claims it with `mcp_take_jobs`
// and reports completion with `mcp_complete_job`.

/** A dispatch job, as the Rust queue hands it to this window. */
export interface McpJob {
  job_id: string;
  project_id: string;
  action: string;
  args: unknown;
  status: string;
}

/** This window's queued jobs it has never been handed (the single claim
 *  path — a job is dispatched once, ever). A no-op outside the app. */
export function mcpTakeJobs(): Promise<McpJob[]> {
  if (!isNative) return Promise.resolve([]);
  return invoke<McpJob[]>("mcp_take_jobs");
}

/** Report a job's completion, from the window that ran it: `result` is the
 *  outcome (`run-analysis`: the `AnalysisResult`), `created` what the job
 *  created, if any. A no-op outside the app. */
export function mcpCompleteJob(
  jobId: string,
  status: "done" | "error",
  result?: unknown,
  error?: string,
  created?: unknown,
) {
  if (!isNative) return Promise.resolve();
  return invoke("mcp_complete_job", {
    jobId,
    status,
    result: result ?? null,
    error: error ?? null,
    created: created ?? null,
  });
}

/** Calls `handler` with a job id whenever Rust wakes this window about a
 *  queued job — the dispatcher then claims it with `mcpTakeJobs`. No-op
 *  outside the app. Returns the unlisten function. */
export async function onMcpRunJob(handler: (jobId: string) => void) {
  if (!isNative) return () => {};
  return getCurrentWebviewWindow().listen<string>("mcp-run-job", ({ payload }) => handler(payload));
}

/** Calls `handler` with a job id when Rust cancels a job this window is
 *  running — the dispatcher stops that job's execution (`cancel_r` for a
 *  run-analysis job). No-op outside the app. Returns the unlisten function. */
export async function onMcpCancelJob(handler: (jobId: string) => void) {
  if (!isNative) return () => {};
  return getCurrentWebviewWindow().listen<string>("mcp-cancel-job", ({ payload }) => handler(payload));
}

// ── R engine ───────────────────────────────────────────────────────────
// One R for the whole app, in the hidden "engine" window. The native shell
// passes each request there and its answer back (see main.rs, `REngine`).

/** From a project window: runs R code in the engine. */
export function evalR(code: string): Promise<RVector> {
  return invoke<RVector>("eval_r", { code }).catch((err: unknown) => {
    throw new Error(String(err));
  });
}

/** From a project window: stop this window's own R work in the engine, if
 *  any is. The shell drops only this window's waiting requests and tells
 *  the engine window which ones, so a queued evaluation is dequeued
 *  without touching R — another window's in-flight install is left alone
 *  (FL-F14). From the engine window (its stuck-engine recovery) it drops
 *  every waiting request instead. Best effort, never throws. */
export async function cancelR(): Promise<void> {
  if (!isNative) return;
  try {
    await invoke("cancel_r");
  } catch {
    // Best effort: the caller's watchdog rejects with the timeout/cancel
    // error either way.
  }
}

/** De-duplicates engine request ids within one engine page: the shell can
 *  re-send an id `r_ready` already sent directly (CC-m6) — this page runs
 *  it once. A fresh page starts with an empty set, so a genuine restart's
 *  re-send still runs. Returns whether this id is new (run it) or a repeat
 *  (drop it). */
export function createEvalDedupe() {
  const seen = new Set<number>();
  return (id: number): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  };
}

/** In the engine window: answers every request with `evaluate`, one at a
 *  time, in arrival order — the app's explicit FIFO (M17: webR serializes
 *  internally too, but that queue is invisible; this one publishes its
 *  state on "r-queue" so project windows can show a queue position instead
 *  of bare "Running…"). A request cancelled by its window is dequeued
 *  (FL-F14), so a queued check's cancel never touches the running
 *  evaluation; a request whose caller gave up some other way still runs
 *  once when it reaches the front — the shell discards its late result —
 *  so a cancelled caller never wedges the queue. */
export async function serveR(evaluate: (code: string) => Promise<RVector>) {
  // The engine (re)started: until it says it is ready, no request may be
  // sent straight to it (R3-03). The shell clears its `ready` flag here,
  // so a request arriving between this window's listeners attaching and
  // `r_ready` is queued once and re-sent once — never emitted twice.
  await invoke("r_starting");
  const dedupeEval = createEvalDedupe();
  const queue = createEvalQueue((snapshot) => {
    setRQueueSnapshot(snapshot);
    // Best effort: project windows listen for "r-queue" and show the depth.
    void getCurrentWebviewWindow().emit("r-queue", snapshot).catch(() => {});
  });
  await getCurrentWebviewWindow().listen<[number, string]>("r-eval", ({ payload: [id, code] }) => {
    // The shell can re-send an id `r_ready` already sent directly (CC-m6):
    // this page runs each id once, so the re-send is dropped here. A fresh
    // page starts with an empty set, so a genuine restart's re-send — the
    // old page's evaluations are dead with it — still runs.
    if (!dedupeEval(id)) return;
    queue.enqueue(() => evaluate(code), id).then(
      (values) => invoke("r_result", { id, values }),
      (err: unknown) => invoke("r_result", { id, error: err instanceof Error ? err.message : String(err) }),
    );
  });
  // A project window cancelled its own requests (its watchdog fired, or
  // the user hit Cancel): the shell dropped them and sends their ids.
  // Dequeue the ones still waiting — without touching R — and interrupt R
  // only if the evaluation now running is one of them. A queued cancel
  // used to clear every window's waiting requests and restart the engine,
  // killing another window's in-flight install (FL-F14).
  await getCurrentWebviewWindow().listen<number[]>("r-cancel", ({ payload: ids }) => {
    if (queue.cancel(ids).runningCancelled) {
      // A bare interrupt is a no-op on Tauri's PostMessage channel, so it
      // alone would leave the engine wedged until the 5-minute watchdog
      // budget ran out (R3-03): abort this window's live evaluations too,
      // which starts their watchdog's 5-second grace — if R is still stuck
      // after it, the engine is abandoned and reloaded (onEngineStuck).
      // The queue runs one evaluation at a time, and `runningCancelled`
      // means that one is the canceller's, so no other window's work is
      // touched.
      interruptR();
      cancelActiveEvals();
    }
  });
  // The engine window itself asked R to stop (its stuck-engine recovery,
  // before the reload): interrupt this window's R, and abort its live
  // evaluations so the watchdog's grace / reload escalation runs even
  // where the interrupt itself is a no-op (R3-03).
  await getCurrentWebviewWindow().listen("r-interrupt", () => {
    interruptR();
    cancelActiveEvals();
  });
  await invoke("r_ready");
}

/** In a project window: keeps this window's copy of the R queue's state
 *  current (the engine window publishes "r-queue" whenever it changes).
 *  No-op outside the app (tests, `npm run web`) — the snapshot stays null
 *  there. Returns the unlisten function. */
export async function onRQueue() {
  if (!isNative) return () => {};
  return getCurrentWebviewWindow().listen<RQueueSnapshot>("r-queue", ({ payload }) => setRQueueSnapshot(payload));
}

/** In a project window: the engine window (re)started, so its R is fresh
 *  with an empty VFS — this window's installed-package states are void
 *  with it (R3-02). Clear them (`resetR`), or the next analysis would see
 *  its packages `ready`, skip the install, and fail with `there is no
 *  package called '…'` in the fresh engine. The shell broadcasts
 *  "r-reset" from `r_ready` (main.rs) on every engine start, including
 *  the first boot (when there is nothing to clear). No-op outside the app.
 *  Returns the unlisten function. */
export async function onEngineReset() {
  if (!isNative) return () => {};
  return getCurrentWebviewWindow().listen("r-reset", () => resetR());
}

/** In the engine window: publish the R boot status to every project window
 *  (CC-m7). A failed boot is no longer silent: project windows show it in
 *  the analysis view instead of leaving the user to discover it on the
 *  first analysis. No-op outside the app. */
export function publishEngineBootStatus(status: EngineBootStatus) {
  if (!isNative) return;
  void getCurrentWebviewWindow().emit("r-boot-status", status).catch(() => {});
}

/** In the engine window: answer a project window asking for the current
 *  boot status (a window opened after the boot missed the publish).
 *  No-op outside the app. Returns the unlisten function. */
export async function onEngineBootStatusRequest(handler: () => void) {
  if (!isNative) return () => {};
  return getCurrentWebviewWindow().listen("r-boot-status-request", handler);
}

/** In a project window: keep this window's copy of the R engine's boot
 *  status current (the engine window publishes "r-boot-status" whenever it
 *  changes). The listen attaches before asking, so the answer cannot slip
 *  past it. No-op outside the app (tests, `npm run web`) — the status
 *  stays null there. Returns the unlisten function. */
export async function onEngineBootStatus(handler: (status: EngineBootStatus) => void) {
  if (!isNative) return () => {};
  const off = await getCurrentWebviewWindow().listen<EngineBootStatus>("r-boot-status", ({ payload }) =>
    handler(payload),
  );
  // Ask the engine window for its current status: a window opened after
  // the boot missed the publish, and a retry that finally booted must
  // clear a failure this window already showed.
  void getCurrentWebviewWindow().emit("r-boot-status-request").catch(() => {});
  return off;
}

// ── Window ─────────────────────────────────────────────────────────────

/** The window's title, and what the shell needs to know of its project: its file,
 *  its unsaved changes (the dot in the close button), and whether it is blank. */
export function setDocument(title: string, path: string | null, edited: boolean, blank: boolean) {
  if (!isNative) return;
  void win().setTitle(title);
  void invoke("set_document", { path, edited, blank });
}

/** Recent projects (newest first), also listed by macOS in the Dock icon's menu. */
export function setRecentDocuments(paths: string[]) {
  if (isNative) void invoke("set_recent_documents", { paths });
}

/** How long the page gets to go quiet before the window is destroyed (BUG-12). */
const CLOSE_QUIESCE_MS = 250;

/** Quiets the page before the window is destroyed (BUG-12): Titer 1.6.1 crashed on
 *  close (EXC_BAD_ACCESS in WebKit's RemoteLayerTreeDrawingAreaProxy::commitLayerTree)
 *  because the live, actively-committing WKWebView was destroyed in the same runloop
 *  turn as the close approval, while layer-tree commit IPC was still queued. Hiding
 *  the window detaches the display link — the commit pump behind both the Nov 17
 *  commitLayerTree crashes and the Nov 15 didRefreshDisplay crash; stopping loads
 *  and clearing the document stop content-change commits (timers, animations,
 *  ResizeObserver re-renders); the drain lets already-queued IPC dispatch while the
 *  drawing-area proxy still exists. The window is already hidden, so the close still
 *  feels instant. Best-effort throughout: a failure here must never leave a window
 *  unclosable. Runs only once the save question is settled (see onCloseRequested). */
async function quiesceBeforeClose(): Promise<void> {
  try {
    await win().hide();
  } catch {
    // A window that won't hide still closes; the drain below still helps.
  }
  try {
    window.stop();
  } catch {
    // Nothing was loading; nothing to stop.
  }
  try {
    document.body?.replaceChildren();
  } catch {
    // The document is already gone; nothing to clear.
  }
  await new Promise<void>((resolve) => setTimeout(resolve, CLOSE_QUIESCE_MS));
}

/** Run `canClose` whenever the window is about to close (red button, ⌘W, ⌘Q). A window
 *  that stays open while Titer quits stops the quitting. Once `canClose` says the
 *  window may go, the page is quieted first (quiesceBeforeClose, BUG-12) and only
 *  then is the window destroyed. */
export function onCloseRequested(canClose: () => Promise<boolean>) {
  if (!isNative) return () => {};
  const off = win().onCloseRequested(async (event) => {
    if (await canClose()) {
      await quiesceBeforeClose();
      return;
    }
    event.preventDefault();
    void invoke("cancel_quit");
  });
  return () => void off.then((f) => f());
}

/** The accent color chosen in System Settings ▸ Appearance (#RRGGBB), or null. */
export const accentColor = () => (isNative ? invoke<string | null>("accent_color") : Promise.resolve(null));

/** The text on the clipboard, read for a command of Titer's own (a paste gets it with its
 *  event); in a browser, as it allows. */
export const clipboardText = () =>
  isNative ? invoke<string | null>("clipboard_text") : navigator.clipboard.readText().catch(() => null);

// One request at a time: two sent together may reach the shell in either order, and a
// wheel shown after it was taken away would spin for ever.
let spinner = Promise.resolve();

/** macOS's spinning wheel over this window, centered at `at` (x, y from its top left); null takes it away. */
export function setSpinner(at: [number, number] | null) {
  spinner = spinner.then(() => invoke<void>("set_spinner", { at })).catch(() => {});
}

/** Titer's GitHub page, its releases, the full releases list, the user
 *  guide, the Prism guides, the support pages, the Titer web site, or
 *  Buy Me a Coffee, in the default browser. */
export const openLink = (
  link:
    | "github"
    | "releases"
    | "releases-list"
    | "coffee"
    | "guide"
    | "curve-fitting"
    | "statistics"
    | "support"
    | "support-policies"
    | "discussions"
    | "site",
) => void invoke("open_link", { link });

/** The support mailbox (seq 453): opens the user's mail app addressed
 *  to smit@muse.ai, with the app version in the subject. The shell only
 *  ever opens that one fixed `mailto:` address. */
export const openSupportEmail = () => invoke<void>("open_support_email");

/** Sends one feedback report straight from the UI (seq 453) — the Help ▸
 *  Send Feedback dialog, no AI needed. Same local-first save and
 *  consent-gated server copy as `titer_send_feedback`. Returns the
 *  share result: `{ feedback_id, received, sent, ... }`. */
export const mcpSendFeedback = (kind: "bug" | "missing-feature" | "other", summary: string, details: string) =>
  invoke<{ feedback_id: string; received: boolean; sent: boolean; sharing?: string; note?: string; error?: string }>(
    "mcp_send_feedback",
    { kind, summary, details },
  );

/** Sends one SAVED feedback report to the team (seq 453) — Settings → AI
 *  Connections. No duplicate save; the server copy is consent-gated. */
export const mcpSendSavedFeedback = (feedbackId: string) =>
  invoke<{ feedback_id: string; received: boolean; sent: boolean; sharing?: string; note?: string; error?: string }>(
    "mcp_send_saved_feedback",
    { feedbackId },
  );

/** Opens a file in its default app (seq 451): the Import dialog's
 *  "Open File to Edit Data" / "Open File" buttons open the file being
 *  imported. The shell refuses a path that names no file. */
export const openFileInDefaultApp = (path: string) => invoke<void>("open_file", { path });

// ── Updates ──────────────────────────────────────────────────────────────
// The shell side lives in src-tauri/src/updater.rs.

/** Fetches the channel manifest through the shell's curl, not the
 *  webview's fetch: the webview enforces CORS and the channel host sends
 *  no Access-Control-Allow-Origin, so the in-page fetch failed fast while
 *  curl answered 200 (P0, Nov 19 2026). Returns the manifest body text. */
export const fetchChannelManifestText = (url: string) =>
  invoke<string>("fetch_channel_manifest", { url });

/** Downloads the update asset to a temp file and checks it against the
 *  channel manifest; the temp path. The shell resolves the artifact
 *  strictly from the channel manifest itself (Round 2 Issue 46) — the
 *  page passes no URL, hash, or size, so a compromised webview cannot
 *  point the updater at an arbitrary host. */
export const downloadUpdate = () => invoke<string>("download_update");

/** Verifies the downloaded asset's version stamp and stages the bundle
 *  swap. Resolves once the swap is staged; the caller then quits, and a
 *  helper swaps the bundle once this process has exited and opens the new
 *  app. */
export const applyUpdate = (path: string, version: string) =>
  invoke<string>("apply_update", { path, version });

/** Quits through the normal flow, as Titer ▸ Quit does: each project
 *  window asks about its unsaved changes first. */
export const quitApp = () => invoke("quit_app");

/** Closes every project window through the normal flow (seq 235): each
 *  asks about its unsaved changes first, a Cancel stops the sequence,
 *  and Titer itself stays open. */
export const closeAll = () => invoke("close_all");

/** Opens a URL in the default browser. Only provider authorize hosts are
 *  allowed (the shell refuses anything else) — used for OAuth sign-in, so
 *  the webview never sees credentials. */
export const openUrl = (url: string) => invoke<void>("open_url", { url });

// ── Cloud storage (v2 item 75, Box first) ────────────────────────────────
// The page only ever sees account identity, listings, and file bytes — never
// a token. All errors arrive as `{ kind, ... }` (see src/lib/cloud.ts).
/** Connected accounts + whether Box has credentials saved (BYO) or a broker. */
export const cloudStatus = () => invoke<CloudStatus>("cloud_status");

/** Sets the persisted "Always use my own Box app" preference for Box
 *  sign-in (skips the Titer broker). */
export const cloudSetBoxPreferByo = (prefer_byo: boolean) =>
  invoke<void>("cloud_set_box_prefer_byo", { preferByo: prefer_byo });

/** Saves the user's own Box app credentials (client id + secret) to the OS
 *  keychain. They are validated at connect time, not here. */
export const cloudSaveBoxCredentials = (client_id: string, client_secret: string) =>
  invoke<void>("cloud_save_box_credentials", { clientId: client_id, clientSecret: client_secret });

/** The Box connect flow: opens Box sign-in in the system browser and waits
 *  for it (up to 5 minutes). Resolves with the connected account. */
export const cloudConnectBox = () => invoke<CloudAccount>("cloud_connect_box");

/** Disconnect: revokes server-side AND deletes the keychain entry. */
export const cloudDisconnect = (provider: ProviderId, account_id: string) =>
  invoke<void>("cloud_disconnect", { provider, accountId: account_id });

/** The entries of a remote folder (`"0"` is the Box root). */
export const cloudList = (provider: ProviderId, account_id: string, folder_id: string) =>
  invoke<RemoteEntry[]>("cloud_list", { provider, accountId: account_id, folderId: folder_id });

/** Downloads a remote file (and writes the local cache copy). */
export const cloudDownload = (provider: ProviderId, account_id: string, file_id: string) =>
  invoke<RemoteDownload>("cloud_download", { provider, accountId: account_id, fileId: file_id });

/** The cache copy of a remote file, for opening while offline. */
export const cloudReadCache = (provider: ProviderId, file_id: string, name: string) =>
  invoke<RemoteDownload>("cloud_read_cache", { provider, fileId: file_id, name });

/** Saves a new remote version, conditional on `expected_version` when
 *  given. `force` is the conflict dialog's explicit "overwrite anyway":
 *  without it, an upload with no known version is refused (conflict)
 *  instead of silently clobbering remote edits. Returns the new version. */
export const cloudUpload = (
  provider: ProviderId,
  account_id: string,
  file_id: string,
  name: string,
  base64: string,
  expected_version: string | null,
  force: boolean,
) =>
  invoke<RemoteVersion>("cloud_upload", {
    provider,
    accountId: account_id,
    fileId: file_id,
    name,
    base64,
    expectedVersion: expected_version,
    force,
  });

/** A new remote file in `folder_id` ("Save as a copy" lands here). */
export const cloudUploadNew = (
  provider: ProviderId,
  account_id: string,
  folder_id: string,
  name: string,
  base64: string,
) => invoke<RemoteEntry>("cloud_upload_new", { provider, accountId: account_id, folderId: folder_id, name, base64 });

export const cloudCreateFolder = (provider: ProviderId, account_id: string, parent_id: string, name: string) =>
  invoke<RemoteEntry>("cloud_create_folder", { provider, accountId: account_id, parentId: parent_id, name });

export const cloudMove = (
  provider: ProviderId,
  account_id: string,
  file_id: string,
  new_parent_id: string,
  is_folder: boolean,
) => invoke<RemoteEntry>("cloud_move", { provider, accountId: account_id, fileId: file_id, newParentId: new_parent_id, isFolder: is_folder });

export const cloudMetadata = (provider: ProviderId, account_id: string, file_id: string) =>
  invoke<RemoteEntry>("cloud_metadata", { provider, accountId: account_id, fileId: file_id });

export const cloudRevisions = (provider: ProviderId, account_id: string, file_id: string) =>
  invoke<RemoteVersion[]>("cloud_revisions", { provider, accountId: account_id, fileId: file_id });

/** Calls `handler` now and whenever the window enters or leaves full screen. */
export function onFullscreenChange(handler: (fullscreen: boolean) => void) {
  if (!isNative) return () => {};
  const check = () => void win().isFullscreen().then(handler);
  check();
  const off = win().onResized(check);
  return () => void off.then((f) => f());
}

/** Calls `handler` now and whenever the window comes to the front or goes behind another. */
export function onFocusChange(handler: (focused: boolean) => void) {
  if (!isNative) return () => {};
  void win().isFocused().then(handler);
  const off = win().onFocusChanged(({ payload }) => handler(payload));
  return () => void off.then((f) => f());
}

export type Theme = "system" | "light" | "dark";

/** The appearance of every window. */
export function setTheme(theme: Theme) {
  if (isNative) void setAppTheme(theme === "system" ? null : theme);
}

// ── Projects ───────────────────────────────────────────────────────────
// Each project has its own window. The shell knows which window holds which
// file, so it decides where a project opens (see main.rs, `Projects`).

/** A project file for a window to open; `untitled`: as a new document, like the sample. */
type Opening = { path: string; untitled: boolean };

/** Opens projects: in their window if they're open, in this one if it's blank, else in new
 *  ones. Rejects with the path of a file that is gone, and opens nothing. */
export const openProjects = (paths: string[]) => invoke("open_projects", { paths });

/** The sample project, which ships inside the app, as a new document. */
export const openSample = () => invoke("open_sample");

/** A new window with a new project. */
export const newProject = () => invoke("new_project");

/** File ▸ Open…: the Open panel, then the chosen project opens as `openProjects` decides. */
export const chooseProject = () => invoke("choose_project");

/** File ▸ Import Prism File…: the Open panel for a Prism file (`.pzfx` or `.prism`).
 *  Non-blocking: the invoke returns at once, and the shell emits
 *  "prism-file-picked" with the path, or null on Cancel, once the user
 *  picks. A blocking picker here deadlocked the app (Nov 9, macOS +
 *  Linux): it parked the main thread while the panel needed that thread
 *  to process clicks. */
export const choosePrismFile = () => invoke("choose_prism_file");

/** Calls `handler` once with the path picked in the Import Prism File
 *  panel, or null if the user cancelled. Await it before opening the
 *  panel so the pick is never missed; it returns the unlisten function. */
export async function onPrismFilePicked(handler: (path: string | null) => void) {
  if (!isNative) return () => {};
  return getCurrentWebviewWindow().listen<string | null>("prism-file-picked", ({ payload }) => handler(payload));
}

/** File ▸ Import Data File…: the Open panel for a data file (`.csv`,
 *  `.tsv`, `.txt`, `.dat`, `.prn` or `.xlsx`). Non-blocking: the invoke returns at once,
 *  and the shell emits "data-file-picked" with the path, or null on Cancel,
 *  once the user picks. A blocking picker here deadlocked the app (Nov 9,
 *  macOS + Linux): it parked the main thread while the panel needed that
 *  thread to process clicks. */
export const chooseDataFile = () => invoke("choose_data_file");

/** Calls `handler` once with the path picked in the Import Data File
 *  panel, or null if the user cancelled. Await it before opening the
 *  panel so the pick is never missed; it returns the unlisten function. */
export async function onDataFilePicked(handler: (path: string | null) => void) {
  if (!isNative) return () => {};
  return getCurrentWebviewWindow().listen<string | null>("data-file-picked", ({ payload }) => handler(payload));
}

/** A data file's (`.csv`, `.tsv`, `.txt`, `.dat`, `.prn`) text, for import. */
export const readDataText = (path: string) => invoke<string>("read_data_text", { path });

/** A data file's (`.xlsx`) bytes, for import — an `.xlsx` file is a ZIP, so
 *  text won't do. The shell returns base64; this decodes it. */
export async function readDataBytes(path: string): Promise<Uint8Array> {
  const base64 = await invoke<string>("read_data_bytes", { path });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A linked-paste source file's contents (Prism 11, seq 168): bytes for an
 *  `.xlsx` workbook, text for a delimited file. */
export async function readLinkedSource(sourcePath: string, kind: "csv" | "xlsx"): Promise<string | Uint8Array> {
  return kind === "xlsx" ? readDataBytes(sourcePath) : readDataText(sourcePath);
}

/** Linked paste (Prism 11, seq 168): after picking a source file, ask
 *  whether the link updates itself when the file changes (Prism's
 *  "Automatically update" checkbox, checked by default), updates by hand,
 *  or cancels the paste. In the web build there is no three-way prompt,
 *  so Cancel is not offered — the paste goes ahead by hand. */
export async function askPasteLink(sourceName: string): Promise<"auto" | "manual" | "cancel"> {
  if (!isNative)
    return window.confirm(`Update “${sourceName}” automatically when the file changes?`) ? "auto" : "manual";
  const answer = await message(`“${sourceName}” will stay linked to this table.`, {
    title: "Paste Link",
    kind: "info",
    buttons: { yes: "Update Automatically", no: "Update By Hand", cancel: "Cancel" },
  });
  if (answer === "Update Automatically" || answer === "Yes") return "auto";
  if (answer === "Update By Hand" || answer === "No") return "manual";
  return "cancel";
}

/** Analysis ▸ Apply Method…: the Open panel for a method file (`.pzm`).
 *  Non-blocking, like `choosePrismFile`: the invoke returns at once, and the
 *  shell emits "method-file-picked" with the path, or null on Cancel, once
 *  the user picks. */
export const chooseMethodFile = () => invoke("choose_method_file");

/** Calls `handler` once with the path picked in the Apply Method panel, or
 *  null if the user cancelled. Await it before opening the panel so the pick
 *  is never missed; it returns the unlisten function. */
export async function onMethodFilePicked(handler: (path: string | null) => void) {
  if (!isNative) return () => {};
  return getCurrentWebviewWindow().listen<string | null>("method-file-picked", ({ payload }) => handler(payload));
}

/** File ▸ Merge…: the Open panel for a project file (`.hlx`, `.pzt`,
 *  `.prism` or `.pzfx`) to merge into this project. Non-blocking, like
 *  `choosePrismFile`: the invoke returns at once, and the shell emits
 *  "merge-file-picked" with the path, or null on Cancel, once the user
 *  picks. A blocking picker here deadlocked the app (Nov 9, macOS +
 *  Linux): it parked the main thread while the panel needed that thread
 *  to process clicks. */
export const chooseMergeFile = () => invoke("choose_merge_file");

/** Calls `handler` once with the path picked in the Merge panel, or null
 *  if the user cancelled. Await it before opening the panel so the pick
 *  is never missed; it returns the unlisten function. */
export async function onMergeFilePicked(handler: (path: string | null) => void) {
  if (!isNative) return () => {};
  return getCurrentWebviewWindow().listen<string | null>("merge-file-picked", ({ payload }) => handler(payload));
}

/** A Prism `.pzfx` file's text, for import. */
export const readPrismText = (path: string) => invoke<string>("read_prism_text", { path });

/** A Prism `.prism` or `.pzf` file's bytes, for import — a `.prism` file is a ZIP
 *  and a `.pzf` file is binary, so text won't do for either. The shell returns base64; this decodes it. */
export async function readPrismBytes(path: string): Promise<Uint8Array> {
  const base64 = await invoke<string>("read_prism_bytes", { path });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** In the engine window: calls `handler` when the last project window has closed. */
export function onNoWindows(handler: () => void) {
  if (!isNative) return () => {};
  const off = getCurrentWebviewWindow().listen("no-windows", handler);
  return () => void off.then((f) => f());
}

/** This window's label ("project-1", "project-2"…), or null outside the
 *  shell. The Welcome dialog auto-shows only on the first project window. */
export function windowLabel(): string | null {
  if (!isNative) return null;
  try {
    return getCurrentWebviewWindow().label;
  } catch {
    return null;
  }
}

/** Calls `handler` with what this window should open: once its page is ready, and
 *  whenever the shell gives it more (⌘O, Open Recent, the Finder, the Dock). */
export function onOpening(handler: (opening: Opening) => void) {
  if (!isNative) return () => {};
  const take = () => invoke<Opening | null>("take_opening").then((opening) => opening && handler(opening));
  // Listening first: an opening given while this window takes the first is not lost.
  const off = getCurrentWebviewWindow().listen("opening", take);
  void off.then(take);
  return () => void off.then((f) => f());
}

/** Calls `handler` with the files dropped on the window. */
export function onDrop(handler: (paths: string[]) => void) {
  if (!isNative) return () => {};
  const off = getCurrentWebviewWindow().onDragDropEvent(({ payload }) => {
    if (payload.type === "drop") handler(payload.paths);
  });
  return () => void off.then((f) => f());
}

// ── Menus ──────────────────────────────────────────────────────────────

export type MenuItems = NonNullable<MenuOptions["items"]>;

// Menus made here live in the shell until closed, even once replaced: each one is
// closed when it's done with, or they would pile up until Titer quits.
let menuBar: (Menu | Submenu)[] = [];
// One menu bar is installed at a time, in the order asked: an earlier one, slower to
// build, never ends up over a later one.
let installing: Promise<void> = Promise.resolve();

/** One open project window, for the Window menu's list (seq 299). */
export type OpenProjectWindow = {
  label: string;
  /** The window's title — its project file's name, or "Untitled". */
  title: string;
  /** True for the window in front. */
  focused: boolean;
};

/** The Window menu's open-project list, in open order: the frontmost window
 *  is checkmarked; picking one focuses it. Empty when no project window is
 *  open — the section is then left out. */
export function windowMenuItems(windows: OpenProjectWindow[], focus: (label: string) => void): MenuItems {
  if (windows.length === 0) return [];
  return [
    { item: "Separator" } as const,
    ...windows.map((w) => ({
      text: w.title || "Untitled",
      checked: w.focused,
      action: () => focus(w.label),
    })),
  ];
}

/** A `project-N` label's N: the shell hands labels out in creation order,
 *  so sorting by it is open order. Anything else sorts first. */
const projectLabelIndex = (label: string) => {
  const n = Number(label.slice("project-".length));
  return Number.isInteger(n) ? n : -1;
};

/** The open project windows, in open order, with the frontmost one marked.
 *  The engine window is not a project window and is left out. No-op
 *  outside the app (tests, `npm run web`) — the list stays empty there. */
export async function openProjectWindows(): Promise<OpenProjectWindow[]> {
  if (!isNative) return [];
  const windows = (await getAllWebviewWindows())
    .filter((w) => w.label.startsWith("project-"))
    .sort((a, b) => projectLabelIndex(a.label) - projectLabelIndex(b.label));
  return Promise.all(
    windows.map(async (w) => ({
      label: w.label,
      // A window still being made has no title yet: it reads as Untitled.
      title: (await w.title().catch(() => "")) || "Untitled",
      focused: await w.isFocused().catch(() => false),
    })),
  );
}

/** Whether the Window menu carries the app's own open-project list (seq 396):
 *  on macOS AppKit appends its own working window list once the menu is the
 *  app's windows menu, and the app's entries there never focus their window
 *  (proven live Nov 23: the app's entries no-op while AppKit's focus) — so
 *  macOS leaves the list to AppKit and the menu has exactly one working
 *  entry per project, no duplicates. Other platforms keep the app's list:
 *  their only window switcher, and the windows-menu registration is a
 *  macOS-only no-op there. */
export function includeAppWindowList(isMacOs: boolean): boolean {
  return !isMacOs;
}

/** Installs the app's menu bar: `menus`, then Window (Minimize / Maximize /
 *  BringAllToFront, plus the open-project list from seq 299 — on Linux and
 *  Windows only; on macOS the list is AppKit's, seq 396) and Help, which
 *  macOS fills with its menu search. */
export function installMenuBar(menus: MenuItems, windowItems: MenuItems, helpItems: MenuItems): Promise<void> {
  if (!isNative) return Promise.resolve();
  const install = async () => {
    // The open-project list (seq 299): every project window by file name,
    // frontmost checkmarked, picking one focuses it. The menu is rebuilt
    // whenever the window in front changes, so the list follows windows
    // opening and closing. On macOS the list is AppKit's, not the app's
    // (seq 396): the app's entries there never focus, and AppKit appends
    // its own working list anyway — building the app's too would duplicate
    // every project and leave dead entries in the menu.
    const open = includeAppWindowList(isMac) ? await openProjectWindows() : [];
    const windows = await Submenu.new({
      text: "Window",
      items: [
        ...windowItems,
        ...windowMenuItems(open, (label) => void WebviewWindow.getByLabel(label).then((w) => w?.setFocus())),
      ],
    });
    const help = await Submenu.new({ text: "Help", items: helpItems });
    const menu = await Menu.new({ items: [...menus, windows, help] });
    await menu.setAsAppMenu();
    await windows.setAsWindowsMenuForNSApp();
    await help.setAsHelpMenuForNSApp();
    const replaced = menuBar;
    menuBar = [menu, windows, help];
    for (const old of replaced) void old.close();
  };
  return (installing = installing.then(install, install));
}

/** A menu item's picture: RGBA pixels, shown 18 points high (36 pixels on Retina). */
export type Picture = { rgba: Uint8Array; width: number; height: number };
type PictureItem = { text: string; icon: Picture; action: () => void };
type PopupItem = MenuItems[number] | PictureItem | { text: string; items: PopupItem[] };
const isPicture = (icon: unknown): icon is Picture =>
  typeof icon === "object" && icon !== null && (icon as Picture).rgba instanceof Uint8Array;

// macOS leaves 8 points more right of a menu's pictures than left of them (room for key
// equivalents): in a menu of pictures alone, each gets that much more on its left
// (16 pixels on Retina), so it shows centered.
const CENTERING = 16;

/** `picture` with `by` transparent pixels more on its left. */
function shifted({ rgba, width, height }: Picture, by: number): Picture {
  const wider = new Uint8Array((width + by) * height * 4);
  for (let y = 0; y < height; y++) {
    wider.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), (y * (width + by) + by) * 4);
  }
  return { rgba: wider, width: width + by, height };
}

/** Shows a native context menu at the pointer (the call returns once it has closed). An
 *  item may show a picture before its text, in a submenu too. With the click `event`,
 *  the menu pops up at the click's position in this window: on macOS a position-less
 *  popup takes muda's nil-view + mouse-location branch, which parked the main thread
 *  inside NSMenu's tracking loop and destroyed every window (QAB-1). The position is
 *  clamped to the visible viewport: a click's coordinates can arrive stale (below the
 *  fold after a scroll-into-view), and an anchor far off-screen parks the main thread
 *  the same way (BUG-2). */
export async function popupMenu(items: PopupItem[], event?: { clientX: number; clientY: number }) {
  if (!isNative) return;
  const images: Image[] = [];
  // Each picture becomes an image the menu can show, freed once it has closed; in a menu
  // of pictures alone (as main.rs tells them: no text; separators aside), centered.
  const withImages = async (list: PopupItem[]): Promise<MenuItems> => {
    const picture = (item: PopupItem) => item.text === "" && "icon" in item && isPicture(item.icon);
    const alone = list.every((item) => !("text" in item) || picture(item));
    return Promise.all(
      list.map(async (item) => {
        if ("icon" in item && isPicture(item.icon)) {
          const picture = alone ? shifted(item.icon, CENTERING) : item.icon;
          const image = await Image.new(picture.rgba, picture.width, picture.height);
          images.push(image);
          return { ...item, icon: image };
        }
        if ("items" in item && Array.isArray(item.items)) {
          return { ...item, items: await withImages(item.items as PopupItem[]) };
        }
        return item;
      }),
    ) as Promise<MenuItems>;
  };
  const menu = await Menu.new({ items: await withImages(items) });
  if (event) {
    const x = Math.min(Math.max(event.clientX, 0), window.innerWidth - 1);
    const y = Math.min(Math.max(event.clientY, 0), window.innerHeight - 1);
    await menu.popup(new LogicalPosition(x, y), getCurrentWindow());
  } else await menu.popup();
  await menu.close();
  for (const image of images) void image.close();
}
