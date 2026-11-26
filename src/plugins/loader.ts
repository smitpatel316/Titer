// Plugin loading + lifecycle — v3 Phase 4 groundwork (roadmap §4b).
//
// A plugin is a folder/zip: `plugin.json` (manifest + analysis specs) +
// code + README. Loading here is deliberately shallow: parse the manifest
// and specs, run the install-time gates (manifest validation, unknown
// permissions, R denylist scan), and record the install. The plugin's JS
// is NEVER executed by this groundwork — there is no Isolation webview
// yet (Phase 4), and executing third-party JS without it would be the
// no-sandbox default the roadmap explicitly does NOT borrow from VS Code.
//
// Lifecycle (Obsidian model, roadmap §4b):
//   install → "disabled" (default; nothing runs)
//   requestEnable → "pending-review" (the UI shows the plain-language
//     permission lines and the user picks what to grant)
//   confirmEnable(granted) → "enabled" (analyses register; only granted
//     permissions count at the capability gate — capabilities.ts)
//   disable → "disabled" (analyses unregister at once)
//   app update → recheckPluginCompatibility: an incompatible plugin goes
//     "incompatible" with a clear message ("needs Titer 3.x") instead of
//     crashing, and is never auto-enabled again — the user re-enables it
//     after its author updates it.
//
// The actual file picking (Tauri dialog / drag-and-drop) and the review UI
// are Phase 4; this module takes bytes (zip) or a file map (folder) so both
// call sites share the same gates.

import JSZip from "jszip";
import {
  manifestReviewLines,
  pluginIncompatibility,
  validatePluginManifest,
  type PluginManifest,
  type PluginPermission,
} from "./manifest";
import { validatePluginAnalysisSpec, type PluginAnalysisSpecJson } from "./analysis-spec";
import {
  getPluginAnalysis,
  pluginAnalysisId,
  registerPluginAnalysesFromManifest,
  registerPluginAnalysis,
  setPluginVersion,
  unregisterPlugin,
  unregisterPluginAnalysis,
} from "./registry";
import {
  clearLiveGrantedPermissions,
  onPluginDisabled,
  setLiveGrantedPermissions,
} from "./isolation";

/** Install lifecycle state. */
export type PluginStatus = "disabled" | "pending-review" | "enabled" | "incompatible";

/** One installed plugin: its manifest + specs, its state, and what the
 *  user granted at the enable review step (a subset of the manifest's
 *  permissions — see capabilities.ts). */
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

/** A parsed plugin package, before install. */
export interface ParsedPluginPackage {
  manifest: PluginManifest;
  analyses: PluginAnalysisSpecJson[];
  /** Non-fatal notes (a missing README) — install proceeds. */
  warnings: string[];
}

/**
 * Parse a plugin folder's files (name → text content). `plugin.json` at the
 * root is required; it carries the manifest AND the analysis specs. The
 * entry file, when the manifest names one, must exist and be JS/TS — no
 * native code, no sidecars from third parties in v3.
 */
export function parsePluginPackage(
  files: ReadonlyMap<string, string>,
): { package: ParsedPluginPackage } | { errors: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rawJson = files.get("plugin.json");
  if (rawJson === undefined) {
    return { errors: ["This plugin has no plugin.json at its root — a plugin folder needs one."] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson) as unknown;
  } catch (err) {
    return { errors: [`plugin.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const manifestResult = validatePluginManifest(raw);
  if ("errors" in manifestResult) return { errors: manifestResult.errors };
  const { manifest } = manifestResult;

  // B5 (LabForge): a plugin may carry no analyses at all — a UI-only
  // plugin (its panel is the product). An absent `analyses` means none;
  // a present one must still be a list of valid specs. A plugin with no
  // analyses must name its entry file: without analyses AND without an
  // entry there is nothing to install.
  const rawAnalyses = (raw as Record<string, unknown>).analyses;
  if (rawAnalyses !== undefined && !Array.isArray(rawAnalyses)) {
    return { errors: ["plugin.json “analyses” must be a list of analysis specs (or absent)."] };
  }
  if (rawAnalyses === undefined && manifest.entry === undefined) {
    return {
      errors: [
        "A plugin with no analyses must name an entry file (“entry” in plugin.json) — a UI-only plugin needs its JavaScript entry point.",
      ],
    };
  }
  const analyses: PluginAnalysisSpecJson[] = [];
  (rawAnalyses ?? []).forEach((specValue, i) => {
    const result = validatePluginAnalysisSpec(specValue, { allowTypeScriptCompute: false });
    if ("errors" in result) {
      errors.push(...result.errors.map((e) => `Analysis ${i + 1}: ${e}`));
    } else {
      analyses.push(result.spec as PluginAnalysisSpecJson);
    }
  });
  if (errors.length) return { errors };

  if (manifest.entry !== undefined) {
    const entry = files.get(manifest.entry);
    if (entry === undefined) {
      errors.push(`Plugin entry “${manifest.entry}” is named in the manifest but is not in the plugin folder.`);
    } else if (!/\.(js|mjs|ts)$/.test(manifest.entry)) {
      errors.push(
        `Plugin entry “${manifest.entry}” is not JavaScript/TypeScript — plugins are JS/TS + R only in v3 (no native code, no sidecars).`,
      );
    }
  }
  if (errors.length) return { errors };

  if (![...files.keys()].some((n) => /^readme(\.md|\.txt)?$/i.test(n))) {
    warnings.push("This plugin has no README — a plugin folder should include one.");
  }
  return { package: { manifest, analyses, warnings } };
}

/** Largest single text entry a plugin zip may carry (5 MB), and largest
 *  total text across entries (10 MB): a zip bomb for the in-memory file
 *  map is refused instead of read (Round 2 Issue 7, seq 471). */
export const MAX_PLUGIN_ZIP_ENTRY_BYTES = 5 * 1024 * 1024;
export const MAX_PLUGIN_ZIP_TOTAL_BYTES = 10 * 1024 * 1024;

/** Load a plugin from a zip's bytes (in-app install, marketplace download).
 *  Zip entry paths are attacker-controlled: a `..` segment, an absolute
 *  path, a backslash, or an empty segment (zip-slip) refuses the whole
 *  package instead of letting an entry escape the plugin folder or
 *  shadow `plugin.json` (Round 2 Issue 7, seq 471). */
/** Whether a zip entry path is unsafe to read: a `..` segment, an absolute
 *  path, a backslash, or an empty segment (zip-slip). Split out so the
 *  rule itself is directly testable — a zip library normalises `..`
 *  segments away before the loader ever sees them, so an end-to-end zip
 *  can only exercise the absolute-path and backslash arms (Round 2
 *  Issue 7, seq 471). */
export function isUnsafeZipEntryPath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\\") ||
    path.split("/").some((seg) => seg === ".." || seg === "")
  );
}

export async function loadPluginFromZip(
  bytes: Uint8Array | ArrayBuffer,
  name: string,
): Promise<{ package: ParsedPluginPackage } | { errors: string[] }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    return { errors: [`“${name}” is not a readable zip file: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const files = new Map<string, string>();
  let totalBytes = 0;
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (isUnsafeZipEntryPath(path)) {
      return {
        errors: [
          `“${name}” has an unsafe zip entry path “${path}” — entries must stay inside the plugin folder (no “..”, no absolute path, no backslashes).`,
        ],
      };
    }
    // Text files only: the manifest, code and docs. Binaries (screenshots)
    // travel in the zip but are not read by this groundwork.
    if (!/\.(json|js|mjs|ts|md|txt)$/i.test(path)) continue;
    const text = await entry.async("string");
    if (text.length > MAX_PLUGIN_ZIP_ENTRY_BYTES) {
      return {
        errors: [
          `“${name}” entry “${path}” is too large (${text.length} bytes — the limit is ${MAX_PLUGIN_ZIP_ENTRY_BYTES} bytes per entry).`,
        ],
      };
    }
    totalBytes += text.length;
    if (totalBytes > MAX_PLUGIN_ZIP_TOTAL_BYTES) {
      return {
        errors: [
          `“${name}” is too large in total (${totalBytes} bytes of text — the limit is ${MAX_PLUGIN_ZIP_TOTAL_BYTES} bytes).`,
        ],
      };
    }
    files.set(path, text);
  }
  return parsePluginPackage(files);
}

/** Load a plugin from a folder's files (folder picked by the user). */
export function loadPluginFromFiles(
  files: ReadonlyMap<string, string>,
  name: string,
): { package: ParsedPluginPackage } | { errors: string[] } {
  void name;
  return parsePluginPackage(files);
}

/**
 * Install a parsed package. Plugins install DISABLED by default — nothing
 * runs until the review step enables it. A duplicate id is rejected.
 */
export function installPlugin(
  parsed: ParsedPluginPackage,
  existingIds: readonly string[],
  source: PluginRecord["source"],
): { record: PluginRecord } | { errors: string[] } {
  if (existingIds.includes(parsed.manifest.id)) {
    return { errors: [`Plugin “${parsed.manifest.id}” is already installed.`] };
  }
  return {
    record: {
      manifest: parsed.manifest,
      analyses: parsed.analyses,
      status: "disabled",
      installedAt: new Date().toISOString(),
      grantedPermissions: [],
      source,
    },
  };
}

/** Start the enable review: "disabled" → "pending-review". Invalid
 *  transitions (already enabled, incompatible) are programmer errors and throw. */
export function requestEnable(record: PluginRecord): PluginRecord {
  if (record.status === "enabled") throw new Error(`Plugin “${record.manifest.id}” is already enabled.`);
  if (record.status === "incompatible")
    throw new Error(
      record.incompatibility ?? `Plugin “${record.manifest.id}” is incompatible with this Titer and cannot be enabled.`,
    );
  if (record.status === "pending-review") return record;
  return { ...record, status: "pending-review" };
}

/**
 * Finish the enable review: the user has seen the plain-language
 * permission lines and granted a subset. Grants outside the manifest's
 * declared permissions are rejected (a grant cannot smuggle in a
 * capability the manifest never declared). An incompatible plugin does
 * not enable — it goes "incompatible" with the clear message instead.
 * On success the plugin's analyses register (registry.ts).
 */
export function confirmEnable(
  record: PluginRecord,
  granted: readonly PluginPermission[],
  appVersion: string,
): PluginRecord {
  if (record.status !== "pending-review")
    throw new Error(`Plugin “${record.manifest.id}” is not awaiting review — call requestEnable first.`);
  const undeclared = granted.filter((p) => !record.manifest.permissions.includes(p));
  if (undeclared.length)
    throw new Error(
      `Cannot grant ${undeclared.join(", ")} — the plugin never declared ${undeclared.length > 1 ? "them" : "it"}.`,
    );
  const incompatibility = pluginIncompatibility(record.manifest, appVersion);
  if (incompatibility) {
    return { ...record, status: "incompatible", incompatibility };
  }
  const registered = registerPluginAnalysesFromManifest(record.manifest.id, record.analyses);
  if ("errors" in registered)
    throw new Error(`Could not enable plugin “${record.manifest.id}”: ${registered.errors.join(" ")}`);
  // The installed version is recorded for the workflow dependency check
  // (registry.ts): a range is testable against live state from here on.
  setPluginVersion(record.manifest.id, record.manifest.version);
  // The grants are live from here on: the interceptor enforces them, not
  // any older session snapshot (Round 2 Issue 5, seq 469).
  setLiveGrantedPermissions(record.manifest.id, granted);
  return { ...record, status: "enabled", grantedPermissions: [...granted], incompatibility: undefined };
}

/** Disable a plugin: its analyses unregister at once, so they vanish from
 *  the registry (and from `resolveAnalysis`) immediately. The disable
 *  also tears the plugin's Isolation frame down and revokes its grants
 *  outright — a disabled plugin holds no permissions, so a later
 *  re-enable starts from the grants the user picks then, never from a
 *  stale session or a retained grant set (Round 2 Issue 5, seq 469). */
export function disablePlugin(record: PluginRecord): PluginRecord {
  unregisterPlugin(record.manifest.id);
  clearLiveGrantedPermissions(record.manifest.id);
  onPluginDisabled(record.manifest.id);
  return { ...record, status: "disabled", incompatibility: undefined, grantedPermissions: [] };
}

/**
 * Re-run the compatibility check after an app update. An incompatible
 * plugin disables with its message instead of crashing — and is never
 * auto-enabled again: a plugin that becomes compatible again returns to
 * "disabled" and waits for the user to re-enable it.
 */
export function recheckPluginCompatibility(record: PluginRecord, appVersion: string): PluginRecord {
  const incompatibility = pluginIncompatibility(record.manifest, appVersion);
  if (incompatibility) {
    if (record.status === "enabled" || record.status === "pending-review") {
      unregisterPlugin(record.manifest.id);
      // An incompatible plugin loses its frame and its grants with its
      // enabled state — same revocation as a disable (Round 2 Issue 5).
      clearLiveGrantedPermissions(record.manifest.id);
      onPluginDisabled(record.manifest.id);
    }
    return { ...record, status: "incompatible", incompatibility, grantedPermissions: [] };
  }
  if (record.status === "incompatible") {
    return { ...record, status: "disabled", incompatibility: undefined };
  }
  return record;
}

/**
 * Startup rehydration (seq 461): re-register the analyses of an
 * already-enabled plugin after an app restart. The install record
 * survived in storage, but the in-memory registry did not — without
 * this the plugin claims enabled while its analyses are unrunnable
 * (MCP lists nothing, runs fail "Unknown plugin analysis").
 * An incompatible plugin (the app updated past it) comes back
 * "incompatible", never auto-enabled; a plugin whose analyses cannot
 * register comes back "disabled" so the user can re-enable it.
 * Analyses already registered (e.g. by the code path) are left alone,
 * so rehydration is idempotent.
 */
export function rehydrateEnabledPlugin(record: PluginRecord, appVersion: string): PluginRecord {
  const checked = recheckPluginCompatibility(record, appVersion);
  if (checked.status !== "enabled") return checked;
  const registered: string[] = [];
  for (const spec of record.analyses) {
    const id = pluginAnalysisId(record.manifest.id, spec.id);
    if (getPluginAnalysis(id)) continue;
    const result = registerPluginAnalysis(record.manifest.id, spec);
    if ("errors" in result) {
      for (const rid of registered) unregisterPluginAnalysis(rid);
      return { ...record, status: "disabled" };
    }
    registered.push(result.id);
  }
  setPluginVersion(record.manifest.id, record.manifest.version);
  // The rehydrated grants are live from here on (same as confirmEnable).
  setLiveGrantedPermissions(record.manifest.id, record.grantedPermissions);
  return record;
}

/** The review-step lines for a plugin: what it is, what it can do (plain
 *  language), and the disabled-by-default note. */
export function pluginReviewLines(record: PluginRecord): string[] {
  const lines = manifestReviewLines(record.manifest);
  lines.push(
    record.status === "disabled"
      ? "Installed disabled — nothing runs until you enable it."
      : `Status: ${record.status}.`,
  );
  if (record.grantedPermissions.length) {
    lines.push(`Previously granted: ${record.grantedPermissions.join(", ")}.`);
  }
  if (record.incompatibility) lines.push(record.incompatibility);
  return lines;
}
