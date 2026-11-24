// Minimal semver for the marketplace (versions like "1.2.3", "1.2", "v1.2.3").
// M1's src/plugins/manifest.ts exports parseSemver/semverAtLeast for the
// plugin manifest; this local copy keeps the marketplace independent of the
// loader landing, so the store compiles and pins run before M1 merges.
// The semantics match the documented ones; integration may unify them.

/** A parsed semantic version: `1.2.3`, `1.2`, or `v1.2.3`. No prerelease or
 *  build metadata — a plugin version is a plain release number. */
export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(value: unknown): Semver | null {
  if (typeof value !== "string") return null;
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0) };
}

/** Compare two versions: negative when `a` is older, 0 when equal, positive when newer. */
export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}
