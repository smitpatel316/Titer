// Version pins: a user can pin a known-good version of a plugin. A pin
// means "stay on this version" — while pinned, no update is OFFERED (see
// updates.ts); an explicit update re-points the pin at the new version
// instead of dropping it (the pin survives updates). Pins live in storage
// under MARKETPLACE_PINS_KEY, as { [pluginId]: version }.
import type { StorageLike } from "./storage";
import { parseSemver } from "./semver";

export const MARKETPLACE_PINS_KEY = "titer.marketplace.pins.v1";

/** All pins, or {} when nothing (or nothing usable) is stored. Never throws. */
export function loadPins(storage: StorageLike): Record<string, string> {
  try {
    const raw = storage.getItem(MARKETPLACE_PINS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const pins: Record<string, string> = {};
    for (const [id, version] of Object.entries(parsed)) {
      if (typeof version === "string" && parseSemver(version)) pins[id] = version;
    }
    return pins;
  } catch {
    return {};
  }
}

function savePins(storage: StorageLike, pins: Record<string, string>): void {
  storage.setItem(MARKETPLACE_PINS_KEY, JSON.stringify(pins));
}

/** Pin `pluginId` to `version`. Returns the pinned version. */
export function savePin(storage: StorageLike, pluginId: string, version: string): string {
  const pins = loadPins(storage);
  pins[pluginId] = version;
  savePins(storage, pins);
  return version;
}

/** Drop the pin for `pluginId`, if any. Never throws. */
export function clearPin(storage: StorageLike, pluginId: string): void {
  const pins = loadPins(storage);
  if (pluginId in pins) {
    delete pins[pluginId];
    savePins(storage, pins);
  }
}

/** The pinned version for `pluginId`, or null when it isn't pinned. */
export function pinnedVersion(storage: StorageLike, pluginId: string): string | null {
  return loadPins(storage)[pluginId] ?? null;
}
