// Update offers: a new version is only offered after a short delay, so a
// bad release has time to be pulled before it reaches anyone (the VS Code
// rule — never offer a version the hour it ships). An explicit,
// user-requested update is NOT gated by the delay; only the OFFER is.
import { compareSemver, parseSemver, type Semver } from "./semver";
import type { MarketplaceListing } from "./index";

/**
 * Delay before a newly published version is offered as an update: 24 hours.
 * A version published an hour ago is never offered, however new it is.
 */
export const UPDATE_OFFER_DELAY_MS = 24 * 60 * 60 * 1000;

/** Whether a version published at `publishedAt` may be offered at `nowMs`. */
export function isUpdateOfferable(publishedAt: string, nowMs: number): boolean {
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) return false;
  return published + UPDATE_OFFER_DELAY_MS <= nowMs;
}

/**
 * The version to offer for `listing`, or null: nothing newer, the newest is
 * still inside the delay, or a pin holds the installed version. `pinned`
 * is the pinned version for this plugin, if any.
 */
export function availableUpdateFor(
  listing: MarketplaceListing,
  installedVersion: string,
  pinned: string | null,
  nowMs: number,
): string | null {
  const installed = parseSemver(installedVersion);
  if (!installed) return null;
  let newest: { version: string; semver: Semver; publishedAt: string } | null = null;
  for (const entry of listing.versions) {
    const v = parseSemver(entry.version);
    if (!v) continue;
    if (compareSemver(v, installed) <= 0) continue;
    if (!newest || compareSemver(v, newest.semver) > 0) {
      newest = { version: entry.version, semver: v, publishedAt: entry.publishedAt };
    }
  }
  if (!newest) return null;
  if (pinned !== null && pinned !== newest.version) return null;
  if (!isUpdateOfferable(newest.publishedAt, nowMs)) return null;
  return newest.version;
}
