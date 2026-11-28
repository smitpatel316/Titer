// Plugin secure storage — the host side of `titer.secureGet`,
// `titer.secureSet` and `titer.secureDelete` (LabForge R3).
//
// A plugin's pairing token must survive a Titer restart: without this
// the token lives only in the plugin frame's memory and the scientist
// re-pairs every session. The token lives in the OS keychain (the
// `plugin_secure_*` Tauri commands, Rust in src-tauri/src/cloud.rs),
// namespaced per plugin id — one plugin can never read another's
// entries, and the keychain entry never appears in a file, a log, or
// the app window's storage.
//
// ── The binding that makes it safe ──────────────────────────────────────
// The plugin id is bound at construction from the enabled plugin's
// record — never from the call args. A plugin that passes another
// plugin's id in its args is ignored: the handler always uses the
// bound id. The key is a short plain token name (`labforge-token`);
// the value is an opaque string the host never inspects, logs, or
// echoes back in an error.
//
// ── Registration (PENDING) ─────────────────────────────────────────────
// The command names are `titer.secureGet` / `titer.secureSet` /
// `titer.secureDelete` and their permission is `secure-storage`. Both
// are pending registration — the permission in manifest.ts
// (`KNOWN_PERMISSIONS` + `PERMISSION_DESCRIPTIONS`) and the commands in
// capabilities.ts (`KNOWN_COMMANDS`, `COMMAND_PERMISSIONS`,
// `COMMAND_DESCRIPTIONS`) — held until the `bugfix/r2-plugin-security`
// lane (which owns manifest.ts) lands. Until then the capability guard
// upstream denies the commands as unknown, fail-closed; the handlers
// here are complete and go live the moment the registration lands.
// The Tauri commands themselves (`plugin_secure_get` /
// `plugin_secure_set` / `plugin_secure_delete`) are implemented in
// src-tauri/src/cloud.rs; their `generate_handler!` registration in
// src-tauri/src/main.rs is pending (that file is owned by the
// `bugfix/br-1-81-main-rs` lane). Until it lands, invoking them fails
// with Tauri's unknown-command error, surfaced plainly below.

import { invoke } from "@tauri-apps/api/core";
import type { PluginHostHandler } from "./isolation";

/** The command names, pending capabilities.ts registration. */
export const SECURE_GET_COMMAND = "titer.secureGet";
export const SECURE_SET_COMMAND = "titer.secureSet";
export const SECURE_DELETE_COMMAND = "titer.secureDelete";

/** The permission the three commands need, pending manifest.ts registration. */
export const SECURE_STORAGE_PERMISSION = "secure-storage";

/** The Tauri commands (Rust, src-tauri/src/cloud.rs). */
export const SECURE_STORAGE_GET_INVOKE = "plugin_secure_get";
export const SECURE_STORAGE_SET_INVOKE = "plugin_secure_set";
export const SECURE_STORAGE_DELETE_INVOKE = "plugin_secure_delete";

/** A storage key: a short plain name (`labforge-token`). No slashes,
 *  no separators that could smuggle a second namespace. */
export const SECURE_STORAGE_KEY = /^[A-Za-z0-9._-]{1,64}$/;

/** A plugin id, for the construction-time binding (same charset as
 *  `isValidPluginId` in manifest.ts — inlined here so this module does
 *  not depend on the manifest registration). */
const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{1,127}$/;

/** Largest value the host will store (64 KB — a token is ~100 chars;
 *  the cap stops keychain abuse, it is not a size the plugin should
 *  ever approach). */
export const SECURE_STORAGE_MAX_VALUE_CHARS = 65536;

/** The invoke function (defaults to Tauri's). Tests inject a stub so
 *  no keychain is touched. */
export type SecureStorageInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

function plainError(message: string): Error {
  return new Error(message);
}

function validateKey(args: unknown): string {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw plainError("Secure storage needs { key } (and { value } to store).");
  }
  const key = (args as Record<string, unknown>).key;
  if (typeof key !== "string" || !SECURE_STORAGE_KEY.test(key)) {
    throw plainError("A storage key is a short plain name (letters, digits, “.”, “_”, “-”, up to 64 characters).");
  }
  return key;
}

function validateValue(args: unknown): string {
  const value = (args as Record<string, unknown>).value;
  if (typeof value !== "string") {
    throw plainError("Secure storage stores text — pass the value as a string.");
  }
  if (value.length > SECURE_STORAGE_MAX_VALUE_CHARS) {
    throw plainError("That value is too large to keep in secure storage (64 KB limit).");
  }
  return value;
}

/** Turn an invoke failure into a plain-language error. The key may be
 *  named (it is not a secret); the value is never mentioned. */
function invokeError(action: string, err: unknown): Error {
  if (err instanceof Error && /unknown command|not found/i.test(err.message)) {
    return plainError(
      `Secure storage is not available in this Titer yet — the plugin storage commands are not registered. ${action} was not completed.`,
    );
  }
  return plainError(`Secure storage could not ${action} — the OS keychain refused. Nothing was changed.`);
}

export interface SecureStorageHandlers {
  secureGet: PluginHostHandler;
  secureSet: PluginHostHandler;
  secureDelete: PluginHostHandler;
}

/**
 * Build the three secure-storage host handlers for one plugin. The
 * plugin id is bound here, from the enabled plugin's record — call
 * args can never name another plugin's id. Each handler validates its
 * args, invokes the matching Tauri command, and returns a small
 * result: get → `{ value: string | null }`, set → `{ stored: true }`,
 * delete → `{ deleted: boolean }`.
 */
export function createSecureStorageHandlers(
  pluginId: string,
  invokeImpl: SecureStorageInvoke = (command, args) => invoke(command, args),
): SecureStorageHandlers {
  if (typeof pluginId !== "string" || !PLUGIN_ID.test(pluginId)) {
    throw plainError("Secure storage needs a valid plugin id.");
  }
  const secureGet: PluginHostHandler = async (_command, args) => {
    const key = validateKey(args);
    let value: unknown;
    try {
      value = await invokeImpl(SECURE_STORAGE_GET_INVOKE, { pluginId, key });
    } catch (err) {
      throw invokeError("read from", err);
    }
    if (value !== null && typeof value !== "string") {
      throw plainError("Secure storage returned something unreadable — nothing was stored under that key.");
    }
    return { value: value ?? null };
  };
  const secureSet: PluginHostHandler = async (_command, args) => {
    const key = validateKey(args);
    const value = validateValue(args);
    try {
      await invokeImpl(SECURE_STORAGE_SET_INVOKE, { pluginId, key, value });
    } catch (err) {
      throw invokeError("write to", err);
    }
    return { stored: true };
  };
  const secureDelete: PluginHostHandler = async (_command, args) => {
    const key = validateKey(args);
    let deleted: unknown;
    try {
      deleted = await invokeImpl(SECURE_STORAGE_DELETE_INVOKE, { pluginId, key });
    } catch (err) {
      throw invokeError("delete from", err);
    }
    return { deleted: deleted === true };
  };
  return { secureGet, secureSet, secureDelete };
}
