// The update channel: a static version.json, fetched on startup, never the
// GitHub API (60 checks an hour per network — a lab's Macs share one).
// Shape is Cricket 07's channel manifest (see UPDATE-LOOP-105.md): the
// release script uploads the asset, then writes version.json LAST, so a
// manifest that answers always names an asset that is already there.
import { isNewer } from "./version";
import { fetchChannelManifestText } from "../native";

/** The channel manifest. The release pipeline publishes it before v2 ships. */
export const CHANNEL_MANIFEST_URL = "https://titer.smitpatel.net/channel/version.json";

const CACHED_KEY = "titer.updateManifest";

/** One downloadable file: its URL, sha256, and size in bytes. */
export interface ChannelAsset {
  url: string;
  sha256: string;
  size: number;
}

/** One platform's entry in the channel's startup block. The build numbers
 *  are recorded but not enforced: Titer versions are strings, and the
 *  version is the authority. */
export interface ChannelPlatform {
  latestVersion: string;
  latestBuild?: number;
  minVersion: string;
  minBuild?: number;
  updateUrl?: string;
}

export interface ChannelManifest {
  version: string;
  build?: number;
  notes?: string;
  released?: string;
  /** The installable asset (macOS: a zip of Titer.app). Absent on a
   *  platform with no shipped artifact yet — Linux today. */
  update?: ChannelAsset;
  full?: ChannelAsset;
  fullZip?: ChannelAsset;
  startup?: {
    schema?: number;
    enabled?: boolean;
    disabledMessage?: string;
    message?: string;
    platforms?: { mac?: ChannelPlatform; linux?: ChannelPlatform };
  };
}

export type UpdateState =
  | { kind: "quiet" }
  | { kind: "optional"; version: string }
  | { kind: "forced"; version: string }
  | { kind: "disabled"; message: string };

/** Whether this is macOS: the installed @tauri-apps/api has no os module,
 *  so the webview's user agent decides. */
export function isMacOs(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
}

function isManifest(value: unknown): value is ChannelManifest {
  return typeof value === "object" && value !== null && typeof (value as ChannelManifest).version === "string";
}

/** Why the last live manifest fetch failed, if it did: the reason the
 *  update check shows when it cannot reach the channel either. The P0
 *  hid this entirely — the dialog said only "check your internet
 *  connection" while the network was fine. Cleared on a good fetch. */
let lastFetchError: string | null = null;

/** The last live channel fetch's failure reason, if it failed. */
export function lastChannelFetchError(): string | null {
  return lastFetchError;
}

/** The channel manifest: the live one when it answers, else the cached
 *  one, else null (offline with nothing cached, or the channel not
 *  published yet — a designed state, never an error). A fetch that answers
 *  replaces the cache. The fetch goes through the shell's curl, not the
 *  webview: the webview enforces CORS and the channel host sends no
 *  Access-Control-Allow-Origin, so the in-page fetch failed fast while
 *  curl answered 200 (P0, Nov 19 2026). */
export async function fetchChannelManifest(): Promise<ChannelManifest | null> {
  try {
    const text = await fetchChannelManifestText(CHANNEL_MANIFEST_URL);
    const manifest: unknown = JSON.parse(text);
    if (isManifest(manifest)) {
      lastFetchError = null;
      try {
        localStorage.setItem(CACHED_KEY, JSON.stringify(manifest));
      } catch {
        // No storage: the live manifest still counts.
      }
      return manifest;
    }
    // The shell answered, but not with a manifest (an error page, a
    // wrong shape): say what it was, then fall back to the cache.
    lastFetchError = `the channel answered, but not with a manifest (${text.slice(0, 120)})`;
    console.error(`[update] ${lastFetchError}`);
  } catch (err) {
    // Offline, the channel not published yet, or the shell's fetch
    // refused: log the reason — the P0 swallowed it, and the dialog
    // that followed blamed the internet while the network was fine.
    // (curl's error names the HTTP status where there is one, e.g.
    // "returned error: 404".)
    lastFetchError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[update] channel manifest fetch failed: ${lastFetchError}`);
  }
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(CACHED_KEY) ?? "null");
    return isManifest(cached) ? cached : null;
  } catch {
    return null;
  }
}

/** Which update state this version is in against the manifest:
 *  - disabled: the channel says updates are paused — run normally, no offers.
 *  - quiet: this version is the latest (or newer).
 *  - forced: this version is below the channel's floor — it must not run.
 *  - optional: a newer version is out, this one may keep running. */
export function decideUpdate(current: string, manifest: ChannelManifest): UpdateState {
  if (manifest.startup?.enabled === false) {
    return { kind: "disabled", message: manifest.startup.disabledMessage ?? "Titer updates are paused right now." };
  }
  const platform = isMacOs() ? manifest.startup?.platforms?.mac : manifest.startup?.platforms?.linux;
  const latest = platform?.latestVersion ?? manifest.version;
  if (!isNewer(latest, current)) return { kind: "quiet" };
  const min = platform?.minVersion ?? "0.0.0";
  if (isNewer(min, current)) return { kind: "forced", version: latest };
  return { kind: "optional", version: latest };
}
