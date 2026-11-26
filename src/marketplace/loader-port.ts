// The loader port: the marketplace store's view of the plugin loader.
//
// These types and signatures MIRROR the documented public API in
// src/plugins/loader.ts (v3/plugin-api @ 7b5d9be) — the store takes a
// PluginLoaderPort instead of importing the loader, so M2 builds and pins
// before M1 lands the real module. At integration the app passes the real
// loader functions in (see wiring.ts); if M1 changes a signature, this
// port is where the mismatch surfaces — it must stay in lockstep with the
// documented API.

/** What a plugin may ask to do (documented allowlist, manifest.ts). */
export type PluginPermission =
  | "read-table"
  | "run-analysis"
  | "write-analysis"
  | "save-file"
  | "open-link"
  | "network"
  | "import-data"
  | "secure-storage";

/** Install lifecycle state (documented, loader.ts). */
export type PluginStatus = "disabled" | "pending-review" | "enabled" | "incompatible";

/** The plugin manifest (documented, manifest.ts). */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  author: string;
  license: string;
  permissions: PluginPermission[];
  description?: string;
  homepage?: string;
  entry?: string;
  minAppVersion?: string;
  networkHosts?: string[];
}

/**
 * A plugin.json analysis spec — the real type from analysis-spec.ts
 * (type-only import: no runtime dependency on the loader).
 * M4 interprets it.
 */
import type { PluginAnalysisSpecJson } from "../plugins/analysis-spec";
export type { PluginAnalysisSpecJson };

/** A parsed plugin package, before install (documented, loader.ts). */
export interface ParsedPluginPackage {
  manifest: PluginManifest;
  analyses: PluginAnalysisSpecJson[];
  /** Non-fatal notes (a missing README) — install proceeds. */
  warnings: string[];
}

/** One installed plugin (documented, loader.ts). */
export interface PluginRecord {
  manifest: PluginManifest;
  analyses: PluginAnalysisSpecJson[];
  status: PluginStatus;
  installedAt: string;
  /** Why the plugin is "incompatible", while it is. */
  incompatibility?: string;
  grantedPermissions: PluginPermission[];
  source: { kind: "zip" | "folder"; name: string };
}

/**
 * The loader functions the store needs, with the documented signatures:
 * loadPluginFromZip is async (zip parsing); installPlugin is sync and
 * installs DISABLED by default; requestEnable → confirmEnable is the
 * review step; disablePlugin unregisters at once; rehydrateEnabledPlugin
 * re-registers an already-enabled plugin's analyses after an app restart
 * (seq 461) — the record survived in storage, the registry did not.
 */
export interface PluginLoaderPort {
  loadPluginFromZip(
    bytes: Uint8Array | ArrayBuffer,
    name: string,
  ): Promise<{ package: ParsedPluginPackage } | { errors: string[] }>;
  installPlugin(
    parsed: ParsedPluginPackage,
    existingIds: readonly string[],
    source: PluginRecord["source"],
  ): { record: PluginRecord } | { errors: string[] };
  requestEnable(record: PluginRecord): PluginRecord;
  confirmEnable(record: PluginRecord, granted: readonly PluginPermission[], appVersion: string): PluginRecord;
  disablePlugin(record: PluginRecord): PluginRecord;
  /** Re-register an already-enabled plugin's analyses after a restart.
   *  Returns the record, possibly downgraded to "disabled" (its analyses
   *  cannot register) or "incompatible" (the app updated past it). */
  rehydrateEnabledPlugin(record: PluginRecord, appVersion: string): PluginRecord;
  pluginReviewLines(record: PluginRecord): string[];
}
