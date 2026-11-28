// The app's host router for one enabled plugin (LabForge R1 wiring).
//
// `buildPluginHostRouterFor` builds the `PluginHostHandler` the app
// passes to `interceptPluginCall` (isolation.ts) as the `host` — the
// single point where a plugin's `titer.*` calls reach Titer. The
// capability guard sits upstream of it (`dispatchPluginCommand`, via
// the interceptor), so this module routes, it never grants: a command
// whose permission was not granted never reaches a handler here.
//
// ── What is wired ───────────────────────────────────────────────────────
// The eight catalogue commands (capabilities.ts) route through
// `createPluginHostRouter` with the app's implementations:
//   - `titer.readTable` / `titer.readColumns` — the app's live-store
//     readers (injected: the store is React context, so only the app
//     can read it). `readColumns` is what the LabForge plugin calls
//     with no args to learn the open table: the reader resolves the
//     active table and returns `{ tableName, name, columns }` where
//     `columns` is `Array<{ id, name }>`.
//   - `titer.runAnalysis` / `titer.createAnalysis` — the dispatch seam
//     (`executeJob`, same action names), project already bound by the
//     app's dispatch function.
//   - `titer.saveFile` — the app's save (dialog + write); the plugin
//     passes `{ filename, dataBase64, contentType }` and gets `{ path }`.
//   - `titer.openLink` — the app's link opener (Tauri `open_url`).
//   - `titer.exportResults` — NOT wired: there is no single host seam
//     for it (exports fan out to `export-table-data`, `export-graph`,
//     … in the dispatch seam), and no plugin in the E2E calls it. It
//     fails closed with the router's "no host handler" message until
//     someone wires it deliberately.
// The four LabForge commands route directly (not through
// `createPluginHostRouter`, whose catalogue does not know them yet):
//   - `titer.fetch` → host-fetch.ts (R1, host-scoped)
//   - `titer.importData` → host-import.ts (R2)
//   - `titer.secureGet` / `titer.secureSet` / `titer.secureDelete` →
//     secure-storage.ts (R3, keychain-backed, plugin-id-bound)
// Until their capabilities.ts registration lands, the guard upstream
// denies those four as unknown — fail-closed by design — and they go
// live the moment it lands, with no further code change here.
//
// ── What is NOT wired here (the mount) ──────────────────────────────────
// This module builds the router; it does not mount it. Mounting —
// launching a plugin's frame on enable, tearing it down on disable /
// uninstall, and feeding the router to the frame's postMessage
// plumbing — belongs to the app shell and the marketplace store, whose
// files are owned right now by the `bugfix/r2-plugin-isolation`,
// `fix/461-plugin-registry-rehydrate` and `bugfix/r2-plugin-security`
// lanes. The mount call is: build the router once per enabled plugin
// with the dispatch bound to the open project, then pass it as `host`
// to `interceptPluginCall` for every message from that plugin's frame.
// Nothing in this module may be called before those lanes land —
// except in tests, where the deps are stubs.

import { createPluginHostRouter, type PluginHostHandler, type PluginHostHandlers } from "./isolation";
import { createHostFetchHandler } from "./host-fetch";
import { IMPORT_DATA_COMMAND, createImportDataHandler, type PluginDispatchFn } from "./host-import";
import {
  SECURE_DELETE_COMMAND,
  SECURE_GET_COMMAND,
  SECURE_SET_COMMAND,
  createSecureStorageHandlers,
  type SecureStorageInvoke,
} from "./secure-storage";

/** The plugin this router serves: its id, and the origins it may
 *  fetch (its manifest's `networkHosts` — PENDING manifest.ts
 *  registration; an absent list means nothing is fetchable). */
export interface PluginHostIdentity {
  id: string;
  networkHosts?: readonly string[];
}

/** The app-supplied implementations. Every one is injected so this
 *  module stays testable without the app: tests pass stubs, the app
 *  passes the real seams. */
export interface PluginHostDeps {
  /** The dispatch seam, bound to the open project: `(action, args) => result`. */
  dispatch: PluginDispatchFn;
  /** Read a table from the live store: `{ tableId? }` → the table
   *  (`{ tableId, name, columns: string[], rows }`); no `tableId`
   *  means the active table. */
  readTable: (args: { tableId?: string }) => Promise<unknown>;
  /** Read a table's columns: `{ tableId? }` → `{ tableName, name,
   *  columns: Array<{ id, name }> }`; no `tableId` means the active
   *  table. This is what the LabForge plugin calls. */
  readColumns: (args: { tableId?: string }) => Promise<unknown>;
  /** Save a file: `{ filename, dataBase64?, contentType? }` (or
   *  `data` as an ArrayBuffer) → `{ path }`. The app shows the save
   *  dialog and writes the bytes. */
  saveFile: (args: {
    filename: string;
    dataBase64?: string;
    data?: ArrayBuffer;
    contentType?: string;
  }) => Promise<unknown>;
  /** Open a link in the browser: `{ url }`. */
  openLink: (args: { url: string }) => Promise<unknown>;
  /** Tauri invoke, for secure storage (defaults to the real one). */
  invokeImpl?: SecureStorageInvoke;
}

/** Every command this router serves once the pending registrations
 *  land (8 catalogue + 4 LabForge). */
export const PLUGIN_HOST_COMMANDS: readonly string[] = [
  "titer.readTable",
  "titer.readColumns",
  "titer.runAnalysis",
  "titer.createAnalysis",
  "titer.saveFile",
  "titer.exportResults",
  "titer.openLink",
  "titer.fetch",
  IMPORT_DATA_COMMAND,
  SECURE_GET_COMMAND,
  SECURE_SET_COMMAND,
  SECURE_DELETE_COMMAND,
];

function plainError(message: string): Error {
  return new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `{ tableId? }` — a table id, when given, is a non-empty string. */
function tableArgs(args: unknown, command: string): { tableId?: string } {
  if (args === undefined || args === null) return {};
  if (!isRecord(args)) throw plainError(`“${command}” takes { tableId? }.`);
  if (args.tableId === undefined) return {};
  if (typeof args.tableId !== "string" || args.tableId.trim().length === 0) {
    throw plainError(`“${command}” needs a table id as a non-empty string.`);
  }
  return { tableId: args.tableId.trim() };
}

/** The save args the LabForge plugin passes: a plain filename plus
 *  exactly one of a base64 body or an ArrayBuffer body. */
function saveFileArgs(args: unknown): {
  filename: string;
  dataBase64?: string;
  data?: ArrayBuffer;
  contentType?: string;
} {
  if (!isRecord(args)) throw plainError("titer.saveFile needs { filename, dataBase64?, contentType? }.");
  if (typeof args.filename !== "string" || args.filename.trim().length === 0) {
    throw plainError("titer.saveFile needs a file name.");
  }
  const filename = args.filename.trim();
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..") || filename.length > 255) {
    throw plainError("titer.saveFile needs a plain file name, not a path.");
  }
  const out: { filename: string; dataBase64?: string; data?: ArrayBuffer; contentType?: string } = { filename };
  if (args.dataBase64 !== undefined) {
    if (typeof args.dataBase64 !== "string" || !/^[A-Za-z0-9+/=]*$/.test(args.dataBase64)) {
      throw plainError("titer.saveFile dataBase64 must be a base64 string.");
    }
    out.dataBase64 = args.dataBase64;
  }
  if (args.data !== undefined) {
    if (!(args.data instanceof ArrayBuffer)) throw plainError("titer.saveFile data must be an ArrayBuffer.");
    out.data = args.data;
  }
  if (out.dataBase64 === undefined && out.data === undefined) {
    throw plainError("titer.saveFile needs file data (dataBase64 or data).");
  }
  if (out.dataBase64 !== undefined && out.data !== undefined) {
    throw plainError("titer.saveFile takes one body — dataBase64 or data, not both.");
  }
  if (args.contentType !== undefined) {
    if (typeof args.contentType !== "string") throw plainError("titer.saveFile contentType must be a string.");
    out.contentType = args.contentType;
  }
  return out;
}

/** `{ url }` — an https URL (or http on this computer), no credentials. */
function openLinkArgs(args: unknown): { url: string } {
  if (!isRecord(args) || typeof args.url !== "string" || args.url.trim().length === 0) {
    throw plainError("titer.openLink needs { url }.");
  }
  let url: URL;
  try {
    url = new URL(args.url.trim());
  } catch {
    throw plainError(`“${String(args.url)}” is not a URL titer.openLink can open.`);
  }
  if (url.username !== "" || url.password !== "")
    throw plainError("titer.openLink never opens a URL with credentials in it.");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
    )
  ) {
    throw plainError("titer.openLink only opens https URLs (and http on this computer).");
  }
  return { url: url.href };
}

/**
 * Build the host router for one enabled plugin. The plugin's id and
 * declared fetch hosts are bound here; the app's seams arrive as
 * `deps`. The returned handler is what the app passes as `host` to
 * `interceptPluginCall` — the guard upstream has already checked the
 * caller's granted permissions by then.
 */
export function buildPluginHostRouterFor(identity: PluginHostIdentity, deps: PluginHostDeps): PluginHostHandler {
  if (typeof identity?.id !== "string" || identity.id.trim().length === 0) {
    throw plainError("The plugin host router needs a plugin id.");
  }
  const pluginId = identity.id.trim();
  const fetchHandler = createHostFetchHandler({ allowedOrigins: identity.networkHosts ?? [] });
  const importHandler = createImportDataHandler(deps.dispatch);
  const secure = createSecureStorageHandlers(pluginId, deps.invokeImpl);

  const catalogueHandlers: PluginHostHandlers = {
    "titer.readTable": async (_command, args) => deps.readTable(tableArgs(args, "titer.readTable")),
    "titer.readColumns": async (_command, args) => deps.readColumns(tableArgs(args, "titer.readColumns")),
    "titer.runAnalysis": async (_command, args) => {
      if (!isRecord(args)) throw plainError("titer.runAnalysis needs an object of analysis arguments.");
      return deps.dispatch("run-analysis", args);
    },
    "titer.createAnalysis": async (_command, args) => {
      if (!isRecord(args)) throw plainError("titer.createAnalysis needs an object of analysis arguments.");
      return deps.dispatch("create-analysis", args);
    },
    "titer.saveFile": async (_command, args) => deps.saveFile(saveFileArgs(args)),
    "titer.openLink": async (_command, args) => deps.openLink(openLinkArgs(args)),
  };
  const catalogueRouter = createPluginHostRouter(catalogueHandlers);

  return async (command: string, args: unknown): Promise<unknown> => {
    if (command === "titer.fetch") return fetchHandler(command, args);
    if (command === IMPORT_DATA_COMMAND) return importHandler(command, args);
    if (command === SECURE_GET_COMMAND) return secure.secureGet(command, args);
    if (command === SECURE_SET_COMMAND) return secure.secureSet(command, args);
    if (command === SECURE_DELETE_COMMAND) return secure.secureDelete(command, args);
    return catalogueRouter(command, args);
  };
}
