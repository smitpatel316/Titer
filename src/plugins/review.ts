// Enable review — marketplace M3 (seq 435).
//
// The review step between install (disabled by default) and first
// enable. It presents the plugin's permissions in plain language (the
// manifest's lines — never a raw permission string) and lets the user
// grant a SUBSET: a grant outside the manifest's declared permissions
// is rejected, so a grant cannot smuggle in a capability the manifest
// never declared. Nothing is granted by default — including `network`,
// whose default answer is no.
//
// This module is the pure logic. The dialog itself is
// `PluginEnableReview` (review-view.tsx); the call site that wires it
// to the loader is documented on that component —
// `requestEnable` → review → `confirmEnable(record, granted, appVersion)`.

import { PERMISSION_DESCRIPTIONS, manifestReviewLines, type PluginManifest, type PluginPermission } from "./manifest";

export { manifestReviewLines };

/** One permission as the review UI shows it: the plain-language line
 *  plus whether the user has ticked it (unchecked by default). */
export interface PermissionChoice {
  permission: PluginPermission;
  description: string;
  granted: boolean;
}

/** The manifest's permissions as review choices, in manifest order,
 *  with `granted` pre-ticked (nothing ticked by default). Each
 *  description is looked up per permission: `describePermissions`
 *  returns descriptions in canonical KNOWN_PERMISSIONS order, so
 *  zipping by index mislabels any manifest that lists permissions
 *  in a different order (Issue 4 — a user could approve the wrong
 *  capability). */
export function permissionChoices(
  manifest: PluginManifest,
  granted: readonly PluginPermission[] = [],
): PermissionChoice[] {
  return manifest.permissions.map((permission) => ({
    permission,
    description: PERMISSION_DESCRIPTIONS[permission] ?? permission,
    granted: granted.includes(permission),
  }));
}

/** Split a proposed grant against the manifest: what is granted, what
 *  stays denied (declared but not granted), and what is invalid
 *  (never declared — a grant cannot smuggle it in). */
export function splitGrant(
  manifest: PluginManifest,
  granted: readonly PluginPermission[],
): { granted: PluginPermission[]; denied: PluginPermission[]; invalid: string[] } {
  const declared = new Set(manifest.permissions);
  const grantedList: PluginPermission[] = [];
  const invalid: string[] = [];
  for (const p of granted) {
    if (declared.has(p)) {
      if (!grantedList.includes(p)) grantedList.push(p);
    } else {
      invalid.push(p);
    }
  }
  return {
    granted: grantedList,
    denied: manifest.permissions.filter((p) => !grantedList.includes(p)),
    invalid,
  };
}

/** Validate a proposed grant the way `confirmEnable` (loader.ts) does:
 *  every granted permission must be declared by the manifest. Granting
 *  nothing is valid — a plugin may run with no permissions. */
export function grantSubsetIsValid(
  manifest: PluginManifest,
  granted: readonly PluginPermission[],
): { ok: true; granted: PluginPermission[] } | { ok: false; reason: string } {
  const split = splitGrant(manifest, granted);
  if (split.invalid.length > 0) {
    return {
      ok: false,
      reason:
        `Cannot grant “${split.invalid.join("”, “")}” — ` +
        `“${manifest.name}” does not declare ${split.invalid.length === 1 ? "it" : "them"} in its manifest, ` +
        `so there is nothing to grant.`,
    };
  }
  return { ok: true, granted: split.granted };
}
