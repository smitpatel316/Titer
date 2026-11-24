// IPC capability enforcement — marketplace M3 (seq 435).
//
// The guard between plugin code and the app: before any `titer.*`
// command is dispatched on a plugin's behalf, the plugin's GRANTED
// permissions (from the enable review step — a subset of what its
// manifest declares) are checked against the closed command catalogue
// in capabilities.ts. Fail-closed: an unknown command, a command whose
// permission was never declared, and a command whose permission was
// declared but not granted all deny.
//
// ── Wire-up point (for the M5 lane) ──────────────────────────────────────
// There is NO plugin dispatch point in the app today — no plugin JS is
// executed at all (the groundwork loader never runs plugin code), so
// there is nothing to wire this into yet, and this lane invents no
// dispatch layer. When M5 builds the Isolation webview, its IPC
// interceptor must route every plugin `titer.*` call through
// `dispatchPluginCommand` (below) with the calling plugin's granted
// permissions, and only forward the call when it allows it. The host
// side it forwards to is the existing dispatch seam:
// `executeJob` in src/store/mcp-dispatch.ts (the extension point where
// job actions — read-table, run-analysis, save, export, open-link —
// execute) for table/analysis work, and the Tauri `invoke` commands in
// src/native.ts for file dialogs. Plugin calls must NEVER go directly
// to `executeJob` or to `invoke`: the guard is the only path in.
// The MCP job channel itself (Rust → `mcp-run-job` → `executeJob`) is
// the user's own agent, not plugin code, so the guard is NOT wired
// into `executeJob` — that would check plugin grants against the
// user's own jobs.

import { CapabilityDeniedError, checkCapability, requireCapability, type CapabilityCheck } from "./capabilities";
import type { PluginPermission } from "./manifest";

export { CapabilityDeniedError } from "./capabilities";
export type { CapabilityCheck } from "./capabilities";

/** Who is calling, and what the user granted them at the enable review
 *  step. Grants are always a subset of the manifest's declared
 *  permissions (enforced by review.ts / loader.ts). */
export interface PluginCommandContext {
  pluginId: string;
  grantedPermissions: readonly PluginPermission[];
}

/** The fail-closed check for one command, in this plugin's context. */
export function checkPluginCommand(ctx: PluginCommandContext, command: string): CapabilityCheck {
  return checkCapability(ctx.grantedPermissions, command);
}

/** The throwing form of `checkPluginCommand`. */
export function requirePluginCommand(ctx: PluginCommandContext, command: string): void {
  requireCapability(ctx.grantedPermissions, command);
}

/**
 * Dispatch a `titer.*` command on a plugin's behalf: check the granted
 * permissions first, run the host handler only when allowed, and throw
 * `CapabilityDeniedError` otherwise. The handler is the host-side
 * implementation (an `executeJob` action, a Tauri invoke, …) — the
 * guard never implements the command itself.
 */
export async function dispatchPluginCommand<T>(
  ctx: PluginCommandContext,
  command: string,
  handler: () => Promise<T> | T,
): Promise<T> {
  const check = checkPluginCommand(ctx, command);
  if (!check.allowed) throw new CapabilityDeniedError(command, check.reason);
  return handler();
}
