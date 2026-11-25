// Workflow step plugin dependencies — v3 Phase 4 (M4).
//
// A workflow step declares the plugin it needs (id + version range); this
// module checks the declaration against what is installed and reports a
// missing or disabled plugin as a "needs plugin X — install it?" notice
// instead of failing the workflow. The workflow engine itself does not
// exist yet — it will call `checkPluginDependency` per step and show the
// notice where the step would have run. M2's graceful-degrade ("this step
// needs plugin X — install it?") uses this same check.
//
// The default install lookup reads the live plugin registry: a plugin
// counts as enabled while any of its analyses is registered (the loader
// unregisters on disable, so a disabled plugin vanishes from the registry
// at once) and its version is the one the loader recorded on enable. A
// caller with a real plugin store (M2) passes its own lookup, which is
// the only way to tell "installed but disabled" from "not installed" —
// the registry alone cannot tell them apart.

import { getPluginVersion, listPluginAnalyses } from "./registry";
import { parseSemver, type Semver } from "./manifest";

/** What a workflow step declares: the plugin it needs, and the versions
 *  it accepts (`*`, `1.2.3`, `^1.2.0`, `~1.2.0`, `>=1.2.0`, …). No range
 *  means any installed version. */
export interface PluginDependency {
  pluginId: string;
  versionRange?: string;
  /** Friendly name for the notice; falls back to the id. */
  pluginName?: string;
}

/** One installed plugin, as a lookup reports it. */
export interface InstalledPlugin {
  /** The installed version — absent when the install never recorded one
   *  (a plugin registered in code, not through the loader). */
  version?: string;
  enabled: boolean;
}

/** The check's answer: ready, or the notice to show instead of running. */
export type PluginDependencyCheck =
  | { ok: true; pluginId: string; version?: string }
  | {
      ok: false;
      pluginId: string;
      reason: "missing" | "disabled" | "version-mismatch" | "version-unknown";
      notice: string;
      installedVersion?: string;
    };

/** The "needs plugin X — install it?" notice for a missing/disabled plugin. */
function needsNotice(name: string): string {
  return `This step needs plugin “${name}” — install it?`;
}

/** The live-registry lookup: enabled while any analysis is registered. */
function defaultInstalled(pluginId: string): InstalledPlugin | undefined {
  if (!listPluginAnalyses().some((e) => e.pluginId === pluginId)) return undefined;
  return { version: getPluginVersion(pluginId), enabled: true };
}

function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Whether an installed version satisfies a range: `*` (any), an exact
 * version (`1.2.3`), caret (`^1.2.0` — same major, `^0.2.0` — same minor,
 * `^0.0.3` — exact patch), tilde (`~1.2.0` — same major.minor), or a
 * comparison (`>=1.2.0`, `>`, `<=`, `<`, `=`). An unparseable version or
 * range satisfies nothing — fail closed, never guess.
 */
export function satisfiesPluginVersionRange(version: string, range: string): boolean {
  const installed = parseSemver(version);
  if (!installed) return false;
  const r = range.trim();
  if (r === "" || r === "*") return true;
  const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(r);
  if (!m) return false;
  const [, op = "", boundRaw] = m;
  const bound = parseSemver(boundRaw);
  if (!bound) return false;
  const cmp = compareSemver(installed, bound);
  switch (op) {
    case "":
    case "=":
      return cmp === 0;
    case ">=":
      return cmp >= 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case "<":
      return cmp < 0;
    case "~":
      // Same major.minor, at least the bound.
      return cmp >= 0 && installed.major === bound.major && installed.minor === bound.minor;
    case "^": {
      if (cmp < 0) return false;
      if (bound.major > 0) return installed.major === bound.major;
      if (bound.minor > 0) return installed.major === 0 && installed.minor === bound.minor;
      return installed.major === 0 && installed.minor === 0 && installed.patch === bound.patch;
    }
    default:
      return false;
  }
}

/**
 * Check one step's plugin dependency. Missing or disabled → the
 * "needs plugin X — install it?" notice (the step degrades gracefully,
 * it does not fail). A version range the installed plugin does not meet
 * → a version notice naming the installed version. A range against an
 * installed plugin whose version was never recorded → "version unknown":
 * the step reports it instead of assuming the version fits.
 */
export function checkPluginDependency(
  dep: PluginDependency,
  installed: (pluginId: string) => InstalledPlugin | undefined = defaultInstalled,
): PluginDependencyCheck {
  const name = dep.pluginName ?? dep.pluginId;
  const found = installed(dep.pluginId);
  if (!found) {
    return { ok: false, pluginId: dep.pluginId, reason: "missing", notice: needsNotice(name) };
  }
  if (!found.enabled) {
    return { ok: false, pluginId: dep.pluginId, reason: "disabled", notice: needsNotice(name) };
  }
  if (!dep.versionRange) {
    return { ok: true, pluginId: dep.pluginId, version: found.version };
  }
  if (found.version === undefined) {
    return {
      ok: false,
      pluginId: dep.pluginId,
      reason: "version-unknown",
      notice:
        `This step needs plugin “${name}” version ${dep.versionRange}, ` +
        `but the installed version couldn't be verified — check the installed version.`,
    };
  }
  if (!satisfiesPluginVersionRange(found.version, dep.versionRange)) {
    return {
      ok: false,
      pluginId: dep.pluginId,
      reason: "version-mismatch",
      installedVersion: found.version,
      notice:
        `This step needs plugin “${name}” version ${dep.versionRange}, ` +
        `but ${found.version} is installed — update it?`,
    };
  }
  return { ok: true, pluginId: dep.pluginId, version: found.version };
}

/** The user-facing line for a check: the notice when the step cannot run,
 *  empty when it can (nothing to show). */
export function pluginDependencyNotice(check: PluginDependencyCheck): string {
  return check.ok ? "" : check.notice;
}
