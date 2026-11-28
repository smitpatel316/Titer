// Import-into-open-project — the host side of `titer.importData` (LabForge R2).
//
// The plugin downloads approved results to disk (via `titer.saveFile`),
// then hands the file to Titer to import as a NEW table in the open
// project — the same parsers as File ▸ Import Data File…, minus the
// dialog. Until this command exists the P0 fallback stands: the
// scientist imports the downloaded file by hand.
//
// The host implementation is the existing `import-data-file` dispatch
// job (src/store/mcp-dispatch.ts), which never appends to the active
// table — an import always makes a table. This module only validates
// the plugin's args (same extension allowlist, same plain-language
// errors) and forwards the job through the app-supplied dispatch
// function; it never touches the store or the filesystem itself.
//
// ── Registration (PENDING) ─────────────────────────────────────────────
// The command name is `titer.importData` and its permission is
// `import-data`. Both are pending registration — the permission in
// manifest.ts (`KNOWN_PERMISSIONS` + `PERMISSION_DESCRIPTIONS`) and the
// command in capabilities.ts (`KNOWN_COMMANDS`, `COMMAND_PERMISSIONS`,
// `COMMAND_DESCRIPTIONS`) — held until the `bugfix/r2-plugin-security`
// lane (which owns manifest.ts) lands. Until then the capability guard
// upstream denies the command as unknown, fail-closed; the handler here
// is complete and goes live the moment the registration lands, with no
// further code change. The permission name is defined here as a plain
// string (not the `PluginPermission` union) for exactly that reason.

import type { PluginHostHandler } from "./isolation";

/** The command name, pending capabilities.ts registration. */
export const IMPORT_DATA_COMMAND = "titer.importData";

/** The permission the command needs, pending manifest.ts registration. */
export const IMPORT_DATA_PERMISSION = "import-data";

/** The file types the import accepts — the same allowlist as the
 *  `import-data-file` dispatch job (src/store/mcp-dispatch.ts). */
export const IMPORT_DATA_EXTENSIONS: readonly string[] = ["csv", "tsv", "txt", "dat", "prn", "xlsx"];

/** The dispatch function the app binds: `(action, args) => result`,
 *  with the project already bound (the app's `executeJob` wrapper). */
export type PluginDispatchFn = (action: string, args: Record<string, unknown>) => Promise<unknown>;

/** The args `titer.importData` takes. `path` is a filesystem path the
 *  app can read (the file the plugin just saved); `name` is the table
 *  name, defaulting to the file's name. */
export interface ImportDataArgs {
  path: string;
  name?: string;
}

function plainError(message: string): Error {
  return new Error(message);
}

/** Validate the plugin's import args. Throws a plain-language Error on
 *  anything malformed — the plugin shows the message to the scientist. */
export function validateImportDataArgs(args: unknown): ImportDataArgs {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw plainError("titer.importData needs { path, name? }.");
  }
  const a = args as Record<string, unknown>;
  if (typeof a.path !== "string" || a.path.trim().length === 0) {
    throw plainError("titer.importData needs a file path.");
  }
  const path = a.path.trim();
  const ext = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  if (!IMPORT_DATA_EXTENSIONS.includes(ext)) {
    const fileName = path.split(/[\\/]/).pop() ?? path;
    throw plainError(`“${fileName}” is not a data file — import a .csv, .tsv, .txt, .dat, .prn or .xlsx file.`);
  }
  if (a.name !== undefined) {
    if (typeof a.name !== "string" || a.name.trim().length === 0) {
      throw plainError("titer.importData needs a non-empty name.");
    }
    return { path, name: a.name.trim() };
  }
  return { path };
}

/**
 * Build the `titer.importData` host handler. The dispatch function is
 * supplied by the app (bound to the open project); the handler only
 * validates and forwards, and returns the job's result unchanged —
 * `{ project_id, table_id, name, table_type, rows, data_columns, notes }`.
 */
export function createImportDataHandler(dispatch: PluginDispatchFn): PluginHostHandler {
  return async (_command: string, args: unknown): Promise<unknown> => {
    const validated = validateImportDataArgs(args);
    return dispatch("import-data-file", { path: validated.path, ...(validated.name ? { name: validated.name } : {}) });
  };
}
