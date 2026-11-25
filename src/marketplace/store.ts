// The marketplace store: index + installed plugins + pins, behind one
// object the dialog (and later MCP) talks to. Network, storage, the clock
// and the loader are all injected, so pins run offline and deterministic.
//
// Install flow: resolve bytes → sha256 verify (mismatch = refuse, loud) →
// loader.loadPluginFromZip → loader.installPlugin → record persisted
// DISABLED → review step (requestEnable → confirmEnable) enables it.
// Uninstall disables (unregisters at once) and removes the record, the
// cached zip and the pin's trace — nothing of the plugin is left behind.

import { sha256Hex } from "./hash";
import {
  DEFAULT_INDEX_URL,
  listingVersionEntry,
  parseMarketplaceIndex,
  searchListings,
  type MarketplaceIndex,
  type MarketplaceListing,
} from "./index";
import type { PluginLoaderPort, PluginPermission, PluginRecord } from "./loader-port";
import { onPluginDisabled, onPluginUninstalled } from "../plugins/isolation";
import { parseSemver } from "../plugins/manifest";
import { clearPin as clearStoredPin, pinnedVersion as storedPin, savePin as saveStoredPin } from "./pins";
import { availableUpdateFor } from "./updates";
import { defaultStorage, type StorageLike } from "./storage";

/** Installed records, as a JSON array of PluginRecord, in storage. */
export const MARKETPLACE_INSTALLED_KEY = "titer.marketplace.installed.v1";

export interface MarketplaceStoreDeps {
  loader: PluginLoaderPort;
  storage?: StorageLike;
  /** Fetch index text. Default: global fetch. */
  fetchText?: (url: string) => Promise<string>;
  /** Fetch a plugin zip. Default: global fetch. */
  fetchBytes?: (url: string) => Promise<Uint8Array>;
  /** Load a bundled fixture zip by file name (offline sample). */
  loadBundledZip?: (name: string) => Promise<Uint8Array>;
  now?: () => number;
  appVersion?: string;
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch the marketplace index (${res.status} ${url}).`);
  return res.text();
}

async function defaultFetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the plugin (${res.status} ${url}).`);
  return new Uint8Array(await res.arrayBuffer());
}

export class MarketplaceStore {
  readonly storage: StorageLike;
  private readonly loader: PluginLoaderPort;
  private readonly fetchText: (url: string) => Promise<string>;
  private readonly fetchBytes: (url: string) => Promise<Uint8Array>;
  private readonly loadBundledZip?: (name: string) => Promise<Uint8Array>;
  private readonly now: () => number;
  private readonly appVersion: string;
  private index: MarketplaceIndex | null = null;
  private installed = new Map<string, PluginRecord>();
  private zipCache = new Map<string, Uint8Array>();

  constructor(deps: MarketplaceStoreDeps) {
    this.loader = deps.loader;
    this.storage = deps.storage ?? defaultStorage();
    this.fetchText = deps.fetchText ?? defaultFetchText;
    this.fetchBytes = deps.fetchBytes ?? defaultFetchBytes;
    this.loadBundledZip = deps.loadBundledZip;
    this.now = deps.now ?? (() => Date.now());
    this.appVersion = deps.appVersion ?? "1.9.0";
    this.loadInstalled();
  }

  private loadInstalled(): void {
    try {
      const raw = this.storage.getItem(MARKETPLACE_INSTALLED_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const value of parsed) {
        const record = value as PluginRecord;
        if (typeof record?.manifest?.id === "string") this.installed.set(record.manifest.id, record);
      }
      // Seq 461: the record survived, the registry did not — an enabled
      // plugin's analyses must be re-registered on startup, or the plugin
      // claims enabled while unrunnable (MCP lists nothing, runs fail).
      // A plugin that cannot re-register comes back disabled/incompatible
      // instead of enabled-but-empty; the stored record is left alone, so
      // the next launch retries. One bad plugin never takes the rest down.
      for (const record of this.installed.values()) {
        if (record.status !== "enabled") continue;
        try {
          this.installed.set(record.manifest.id, this.loader.rehydrateEnabledPlugin(record, this.appVersion));
        } catch {
          this.installed.set(record.manifest.id, { ...record, status: "disabled" });
        }
      }
    } catch {
      // A corrupt installed list starts empty rather than breaking the store.
      this.installed.clear();
    }
  }

  private persistInstalled(): void {
    this.storage.setItem(MARKETPLACE_INSTALLED_KEY, JSON.stringify([...this.installed.values()]));
  }

  private requireInstalled(id: string): PluginRecord {
    const record = this.installed.get(id);
    if (!record) throw new Error(`Plugin “${id}” is not installed.`);
    return record;
  }

  // ── Index ──────────────────────────────────────────────────────────────

  loadIndexFromText(text: string): { index: MarketplaceIndex } | { errors: string[] } {
    const parsed = parseMarketplaceIndex(text);
    if ("errors" in parsed) return parsed;
    this.index = parsed.index;
    return parsed;
  }

  async fetchIndex(url: string = DEFAULT_INDEX_URL): Promise<{ index: MarketplaceIndex } | { errors: string[] }> {
    let text: string;
    try {
      text = await this.fetchText(url);
    } catch (err) {
      return { errors: [`Could not fetch the marketplace index: ${err instanceof Error ? err.message : String(err)}`] };
    }
    return this.loadIndexFromText(text);
  }

  getIndex(): MarketplaceIndex | null {
    return this.index;
  }

  /** Browse/search the loaded index (empty query lists everything). */
  search(query: string): MarketplaceListing[] {
    return this.index ? searchListings(this.index, query) : [];
  }

  // ── Install ────────────────────────────────────────────────────────────

  /**
   * Install a listing (default: its current version). Download → sha256
   * verify → parse → install DISABLED. A hash mismatch refuses, loudly,
   * and installs nothing. The review step (requestEnable → confirmEnable)
   * is separate — install alone never enables anything.
   */
  async installListing(
    listing: MarketplaceListing,
    version?: string,
  ): Promise<{ record: PluginRecord } | { errors: string[] }> {
    const targetVersion = version ?? listing.version;
    const entry = listingVersionEntry(listing, targetVersion);
    if (!entry) {
      return { errors: [`“${listing.name}” has no version ${targetVersion} in its version history.`] };
    }
    let bytes: Uint8Array;
    try {
      bytes =
        entry.bundledFile && this.loadBundledZip
          ? await this.loadBundledZip(entry.bundledFile)
          : await this.fetchBytes(entry.downloadUrl);
    } catch (err) {
      return {
        errors: [
          `Could not download “${listing.name}” ${targetVersion}: ${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }
    let actual: string;
    try {
      actual = await sha256Hex(bytes);
    } catch (err) {
      return { errors: [`Could not verify “${listing.name}” ${targetVersion}: ${err instanceof Error ? err.message : String(err)}`] };
    }
    if (actual.toLowerCase() !== entry.sha256.trim().toLowerCase()) {
      return {
        errors: [
          `Refusing to install “${listing.name}” ${targetVersion}: hash mismatch — the download does not match the index ` +
            `(expected ${entry.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…). The file may be corrupt or tampered with.`,
        ],
      };
    }
    const parsed = await this.loader.loadPluginFromZip(bytes, `${listing.id}-${targetVersion}.zip`);
    if ("errors" in parsed) return { errors: parsed.errors };
    // The zip is attacker-influenced bytes (a mirror, a tampered download
    // whose hash the index also got wrong): the manifest inside it must
    // identify the listing being installed, at the version being
    // installed — a spoofed id would otherwise install one plugin under
    // another's name, and a mismatched version would silently install
    // the wrong release (Round 2 Issue 7, seq 471). Versions compare by
    // number, so "1.0" and "v1.0.0" are the same release.
    const manifest = parsed.package.manifest;
    if (manifest.id !== listing.id) {
      return {
        errors: [
          `Refusing to install “${listing.name}” ${targetVersion}: the download identifies itself as plugin “${manifest.id}”, not “${listing.id}”. The file may be mislabelled or tampered with.`,
        ],
      };
    }
    const manifestVersion = parseSemver(manifest.version);
    const target = parseSemver(targetVersion);
    if (!manifestVersion || !target || manifestVersion.major !== target.major || manifestVersion.minor !== target.minor || manifestVersion.patch !== target.patch) {
      return {
        errors: [
          `Refusing to install “${listing.name}” ${targetVersion}: the download is version ${manifest.version}, not ${targetVersion}. The file may be mislabelled or tampered with.`,
        ],
      };
    }
    const installed = this.loader.installPlugin(parsed.package, [...this.installed.keys()], {
      kind: "zip",
      name: `${listing.id}-${targetVersion}.zip`,
    });
    if ("errors" in installed) return { errors: installed.errors };
    // Installed under the LISTING id, never the zip's manifest id — the
    // two are equal after the check above, but the key must not come from
    // zip-controlled bytes (Round 2 Issue 7, seq 471).
    this.installed.set(listing.id, installed.record);
    this.zipCache.set(listing.id, bytes);
    this.persistInstalled();
    return installed;
  }

  // ── Review / enable / disable ──────────────────────────────────────────

  /** The review-step lines for an installed plugin (plain language). */
  reviewLines(id: string): string[] {
    return this.loader.pluginReviewLines(this.requireInstalled(id));
  }

  /** Start the enable review: "disabled" → "pending-review". */
  requestEnable(id: string): PluginRecord {
    const record = this.loader.requestEnable(this.requireInstalled(id));
    this.installed.set(id, record);
    this.persistInstalled();
    return record;
  }

  /**
   * Finish the enable review: the user has seen the permission lines and
   * granted a subset. Grants outside the manifest are rejected by the loader.
   */
  confirmEnable(id: string, granted: readonly PluginPermission[]): PluginRecord {
    const record = this.loader.confirmEnable(this.requireInstalled(id), granted, this.appVersion);
    this.installed.set(id, record);
    this.persistInstalled();
    return record;
  }

  /** Disable: analyses unregister at once, and the plugin's Isolation
   *  frame is torn down with its grants — the loader tears it down, and
   *  the store tears it down too, so the disable holds even for a loader
   *  port that does not (Round 2 Issue 5, seq 469). */
  disable(id: string): PluginRecord {
    const record = this.loader.disablePlugin(this.requireInstalled(id));
    onPluginDisabled(id);
    this.installed.set(id, record);
    this.persistInstalled();
    return record;
  }

  // ── Update / pin ───────────────────────────────────────────────────────

  /** The version on offer for an installed plugin, or null (see updates.ts). */
  availableUpdate(id: string): string | null {
    const record = this.installed.get(id);
    if (!record || !this.index) return null;
    const listing = this.index.listings.find((l) => l.id === id);
    if (!listing) return null;
    return availableUpdateFor(listing, record.manifest.version, storedPin(this.storage, id), this.now());
  }

  /**
   * Explicit, user-requested update to `toVersion` (or the newest listed).
   * The delay gates only the OFFER, not an explicit update. A pin follows
   * the update (re-pointed at the new version) instead of being dropped.
   * An enabled plugin is re-enabled with the grants it already had; if the
   * new version can't re-enable, it stays installed-but-disabled.
   */
  async updatePlugin(
    id: string,
    opts: { toVersion?: string } = {},
  ): Promise<{ record: PluginRecord } | { errors: string[] }> {
    const record = this.installed.get(id);
    if (!record) return { errors: [`Plugin “${id}” is not installed.`] };
    if (!this.index) return { errors: ["No marketplace index is loaded — cannot find the update."] };
    const listing = this.index.listings.find((l) => l.id === id);
    if (!listing) return { errors: [`“${record.manifest.name}” is not in the loaded marketplace index.`] };
    const target =
      opts.toVersion ?? availableUpdateFor(listing, record.manifest.version, null, this.now()) ?? listing.version;
    const wasEnabled = record.status === "enabled";
    const pin = storedPin(this.storage, id);
    this.loader.disablePlugin(record);
    this.installed.delete(id);
    this.zipCache.delete(id);
    const installed = await this.installListing(listing, target);
    if ("errors" in installed) {
      // The old record is gone and the new one failed: restore the old
      // record (disabled) rather than losing the plugin silently.
      this.installed.set(id, { ...record, status: "disabled" });
      this.persistInstalled();
      return installed;
    }
    if (pin !== null) saveStoredPin(this.storage, id, target);
    if (wasEnabled) {
      try {
        this.requestEnable(id);
        this.confirmEnable(id, record.grantedPermissions);
      } catch {
        // The new version stays installed-but-disabled; the user re-enables it.
      }
    }
    const updated = this.installed.get(id);
    if (!updated) return { errors: [`Update installed but the record for “${id}” was lost.`] };
    return { record: updated };
  }

  pinnedVersion(id: string): string | null {
    return storedPin(this.storage, id);
  }

  setPin(id: string, version: string): void {
    saveStoredPin(this.storage, id, version);
  }

  clearPin(id: string): void {
    clearStoredPin(this.storage, id);
  }

  // ── Uninstall ──────────────────────────────────────────────────────────

  /**
   * Uninstall: disable (unregister at once) + remove the record, the cached
   * zip and the pin. Nothing of the plugin is left behind — including its
   * Isolation frame, which is torn down unconditionally: a frame must
   * never survive its plugin's uninstall (Round 2 Issue 5, seq 469).
   */
  uninstall(id: string): { removed: true } | { errors: string[] } {
    const record = this.installed.get(id);
    if (!record) return { errors: [`Plugin “${id}” is not installed.`] };
    if (record.status === "enabled" || record.status === "pending-review") {
      this.loader.disablePlugin(record);
    }
    onPluginUninstalled(id);
    this.installed.delete(id);
    this.zipCache.delete(id);
    clearStoredPin(this.storage, id);
    this.persistInstalled();
    return { removed: true };
  }

  // ── Accessors ──────────────────────────────────────────────────────────

  listInstalled(): PluginRecord[] {
    return [...this.installed.values()];
  }

  getInstalled(id: string): PluginRecord | undefined {
    return this.installed.get(id);
  }

  hasCachedZip(id: string): boolean {
    return this.zipCache.has(id);
  }
}
