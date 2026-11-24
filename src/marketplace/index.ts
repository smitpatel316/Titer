// The marketplace index (Q8 default: a GitHub repo the app browses; no
// hosted server to run). One JSON file lists the plugins; the app fetches
// it from DEFAULT_INDEX_URL, or uses the bundled sample when offline. A
// listing is the manifest + README + screenshots + version history + the
// scorecard slot (M3 renders the scorecard).
import { parseSemver } from "./semver";
import type { ScorecardSummary } from "./scorecard";

/**
 * The default index: a GitHub raw URL. One place to change the source —
 * if Smit later picks hosted-first-party review, only this URL changes.
 */
export const DEFAULT_INDEX_URL =
  "https://raw.githubusercontent.com/smitpatel316/titer-marketplace/main/index.json";

export interface MarketplaceVersionEntry {
  version: string;
  /** ISO 8601 — when this version shipped (drives the update delay). */
  publishedAt: string;
  changelog: string;
  downloadUrl: string;
  sha256: string;
  /** Bundled fixture file (offline sample only) — see store.ts. */
  bundledFile?: string;
}

export interface MarketplaceListing {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  author: string;
  /** Recorded verbatim, never judged (Q7 open — no license allowlist). */
  license: string;
  description?: string;
  downloadUrl: string;
  sha256: string;
  readme?: string;
  screenshots?: string[];
  versions: MarketplaceVersionEntry[];
  /** Safety scorecard (M3). Absent = pending. */
  scorecard?: ScorecardSummary;
  /** True when the zip ships inside the app (offline sample). */
  bundled?: boolean;
  bundledFile?: string;
}

export interface MarketplaceIndex {
  formatVersion: 1;
  updatedAt: string;
  listings: MarketplaceListing[];
}

const SHA256_HEX = /^[0-9a-fA-F]{64}$/;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** The version-history entry for `version`, if the listing carries one. */
export function listingVersionEntry(
  listing: MarketplaceListing,
  version: string,
): MarketplaceVersionEntry | undefined {
  return listing.versions.find((entry) => entry.version === version);
}

/**
 * Parse a marketplace index — a JSON string or an already-parsed value.
 * Unknown keys are ignored (forward compatibility, like manifest
 * validation); anything malformed is rejected with plain-language errors.
 */
export function parseMarketplaceIndex(value: string | unknown): { index: MarketplaceIndex } | { errors: string[] } {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value) as unknown;
    } catch (err) {
      return { errors: [`Marketplace index is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
    }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { errors: ["Marketplace index must be a JSON object."] };
  }
  const errors: string[] = [];
  const v = raw as Record<string, unknown>;
  if (v.formatVersion !== 1) {
    errors.push(`Marketplace index formatVersion “${String(v.formatVersion)}” is not supported — this Titer reads format 1.`);
  }
  if (!Array.isArray(v.listings)) {
    errors.push("Marketplace index must list plugins under “listings”.");
    return { errors };
  }
  const listings: MarketplaceListing[] = [];
  v.listings.forEach((listingValue, i) => {
    const prefix = `Listing ${i + 1}`;
    const errorsBefore = errors.length;
    if (typeof listingValue !== "object" || listingValue === null || Array.isArray(listingValue)) {
      errors.push(`${prefix} must be a JSON object.`);
      return;
    }
    const l = listingValue as Record<string, unknown>;
    const bad = (field: string, why: string) => errors.push(`${prefix}: ${field} ${why}.`);
    if (typeof l.id !== "string" || !l.id.trim()) bad("id", "must be a non-empty string");
    if (typeof l.name !== "string" || !l.name.trim()) bad("name", "must be a non-empty string");
    if (parseSemver(l.version) === null) bad("version", `“${String(l.version)}” is not a version like “1.0.0”`);
    if (parseSemver(l.apiVersion) === null) bad("apiVersion", `“${String(l.apiVersion)}” is not a version like “3.0”`);
    if (typeof l.author !== "string" || !l.author.trim()) bad("author", "must be a non-empty string");
    if (typeof l.license !== "string" || !l.license.trim()) bad("license", "must be a non-empty string");
    if (!isHttpUrl(l.downloadUrl)) bad("downloadUrl", "must be an http(s) URL");
    if (typeof l.sha256 !== "string" || !SHA256_HEX.test(l.sha256)) bad("sha256", "must be 64 hex characters");
    if (l.description !== undefined && typeof l.description !== "string") bad("description", "must be a string");
    if (l.readme !== undefined && typeof l.readme !== "string") bad("readme", "must be a string");
    if (l.screenshots !== undefined && (!Array.isArray(l.screenshots) || l.screenshots.some((s) => typeof s !== "string"))) {
      bad("screenshots", "must be a list of strings");
    }
    if (l.bundled !== undefined && typeof l.bundled !== "boolean") bad("bundled", "must be true or false");
    if (l.bundledFile !== undefined && typeof l.bundledFile !== "string") bad("bundledFile", "must be a string");
    if (l.scorecard !== undefined) {
      const s = l.scorecard as Record<string, unknown>;
      if (
        typeof s !== "object" ||
        s === null ||
        !["pending", "passed", "flagged"].includes(String(s.status)) ||
        !Array.isArray(s.lines) ||
        s.lines.some((line) => typeof line !== "string")
      ) {
        bad("scorecard", "must have a status (pending/passed/flagged) and a list of lines");
      }
    }
    const versions: MarketplaceVersionEntry[] = [];
    if (!Array.isArray(l.versions) || l.versions.length === 0) {
      bad("versions", "must list at least one version in its version history");
    } else {
      l.versions.forEach((entryValue, j) => {
        const entryPrefix = `${prefix} version ${j + 1}`;
        if (typeof entryValue !== "object" || entryValue === null || Array.isArray(entryValue)) {
          errors.push(`${entryPrefix} must be a JSON object.`);
          return;
        }
        const e = entryValue as Record<string, unknown>;
        if (parseSemver(e.version) === null) errors.push(`${entryPrefix}: version “${String(e.version)}” is not a version like “1.0.0”.`);
        if (typeof e.publishedAt !== "string" || Number.isNaN(Date.parse(e.publishedAt))) {
          errors.push(`${entryPrefix}: publishedAt must be an ISO date.`);
        }
        if (typeof e.changelog !== "string") errors.push(`${entryPrefix}: changelog must be a string.`);
        if (!isHttpUrl(e.downloadUrl)) errors.push(`${entryPrefix}: downloadUrl must be an http(s) URL.`);
        if (typeof e.sha256 !== "string" || !SHA256_HEX.test(e.sha256)) {
          errors.push(`${entryPrefix}: sha256 must be 64 hex characters.`);
        }
        if (e.bundledFile !== undefined && typeof e.bundledFile !== "string") {
          errors.push(`${entryPrefix}: bundledFile must be a string.`);
        }
        if (typeof e.version === "string" && typeof e.publishedAt === "string" && typeof e.changelog === "string") {
          versions.push(e as unknown as MarketplaceVersionEntry);
        }
      });
      if (typeof l.version === "string" && !versions.some((entry) => entry.version === l.version)) {
        errors.push(`${prefix}: version history has no entry for its current version “${l.version}”.`);
      }
    }
    if (errors.length > errorsBefore) return;
    listings.push({
      id: l.id as string,
      name: (l.name as string).trim(),
      version: l.version as string,
      apiVersion: l.apiVersion as string,
      author: (l.author as string).trim(),
      license: (l.license as string).trim(),
      ...(typeof l.description === "string" ? { description: l.description } : {}),
      downloadUrl: l.downloadUrl as string,
      sha256: l.sha256 as string,
      ...(typeof l.readme === "string" ? { readme: l.readme } : {}),
      ...(Array.isArray(l.screenshots) ? { screenshots: [...(l.screenshots as string[])] } : {}),
      versions,
      ...(l.scorecard !== undefined ? { scorecard: l.scorecard as ScorecardSummary } : {}),
      ...(l.bundled === true ? { bundled: true } : {}),
      ...(typeof l.bundledFile === "string" ? { bundledFile: l.bundledFile } : {}),
    });
  });
  if (errors.length) return { errors };
  return {
    index: {
      formatVersion: 1,
      updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date().toISOString(),
      listings,
    },
  };
}

/**
 * Browse/search: an empty query lists everything (by name); otherwise a
 * case-insensitive substring match over name, id, author and description.
 */
export function searchListings(index: MarketplaceIndex, query: string): MarketplaceListing[] {
  const q = query.trim().toLowerCase();
  const sorted = [...index.listings].sort((a, b) => a.name.localeCompare(b.name));
  if (!q) return sorted;
  return sorted.filter((listing) =>
    [listing.name, listing.id, listing.author, listing.description ?? ""].some((field) =>
      field.toLowerCase().includes(q),
    ),
  );
}
