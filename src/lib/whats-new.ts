// In-app "What's new" (seq 453, 2.0 launch): the visible close of the
// feedback loop — what shipped, in the app, so a user who reported
// something can see it land. One entry per release, newest first;
// Help ▸ What's New re-opens the dialog on demand, and it auto-shows
// once per version (the seen record below) after an update.
//
// What the dialog shows is only the entries newer than the version
// whose news was last shown (most recent first, max 3) — a user who
// updates every release sees one entry; one who skipped a release sees
// what they missed, never the whole history. The seen record is the
// previously-installed version for this purpose: it names the version
// the user was on when the news last showed. Older notes live on
// GitHub releases, linked from the dialog footer.
//
// The seen record is a localStorage key holding the last version whose
// news was shown, mirroring the startup guide's seen record
// (src/lib/startup-guide.ts): only an explicit match counts as seen, so
// no record, a garbled record or a refusal-shaped value all show the
// news — a bad value never silently takes it away. The helpers never
// throw (no localStorage in tests, private mode, or a full store).
//
// Entries are seeded from the release notes. The newest entry must
// name the version in package.json — pinned by the seq 542 check in
// tests/checks.ts, so a release can never again ship showing the
// previous version's news (2.0.0 shipped with only the 1.9.0 entry).

import { version } from "../../package.json";
import { isNewer } from "./version";

/** One release's news: the version it shipped in, a headline, and the
 *  few lines a user would care about. */
export interface WhatsNewEntry {
  version: string;
  title: string;
  items: string[];
}

/** The news, newest first. */
export const WHAT_S_NEW: WhatsNewEntry[] = [
  {
    version: "2.0.1",
    title: "Titer 2.0.1 — patch fixes",
    items: [
      "Keynote export fixed: graphs now export to a valid .key file that opens in Keynote.",
      "Greek symbols in graph labels now render in exported PDFs, and super/subscript formatting is preserved.",
      "Grouped-bars graph fixes, and Antigravity now sees all MCP tools by default, staying in sync as tools are added.",
      "Citation support: Titer ships a CITATION.cff, and the Zenodo DOI for citing Titer mints with this release.",
    ],
  },
  {
    version: "2.0.0",
    title: "Titer 2.0.0 — our public launch",
    items: [
      "Plugin marketplace, free only: install, enable, and run community plugins from inside Titer — no paid plugins, no marketplace cut, no license allowlist.",
      "Rebuilt Import dialog — five tabs (File, Prism, Text, Clipboard, Script) with a live preview grid — and .dat / .prn files now import directly.",
      "Mac clipboard fixes: Paste Special from the native menu, full-precision Excel values, table copies that paste as a real table, and graph copies as vector PDF.",
      "Help menu completed, and four new MCP tools bring the total to 80 (was 76) — every one of Titer's 61 analyses is reachable from an AI assistant.",
    ],
  },
  {
    version: "1.9.0",
    title: "Titer 1.9.0 — more Prism coverage",
    items: [
      "84.5% of Prism fully covered (397 of 470 features), with new analyses including multifactor ANOVA, hierarchical clustering, and parts-of-whole tables.",
      "One new MCP tool — 76 total — so every one of Titer's 61 analyses is reachable from an AI assistant.",
      "Global-fit notes now say when a Span comes from an unstable Top, and the 1.8.5 fixes (window menu, backup sheets, figure drag-and-drop, sample size & power) are in.",
    ],
  },
];

/** The localStorage key for "the What's New dialog has been shown for
 *  this version". Stored as the version string once shown. */
export const WHATS_NEW_SEEN_KEY = "titer.whats-new-seen";

/** The version whose news the dialog shows: the running app version. */
export function whatsNewVersion(): string {
  return version;
}

/** Whether the news shows for this version: only while the record does
 *  not already name it. */
export function shouldShowWhatsNew(storedValue: unknown): boolean {
  return storedValue !== whatsNewVersion();
}

/** A stored seen value that names a version ("2.0.0", "1.9", "v2.0.1",
 *  "2.0.2-rc.1", "V2.0.1"), or null when it names nothing usable — no
 *  record, a garbled record, or a refusal-shaped value. A bad value
 *  never silently takes the news away: it falls through to the current
 *  entry below. The optional pre-release and the case-insensitive `v`
 *  are accepted (BR-105): a pre-release install used to read as no
 *  record at all. */
export function seenVersion(storedValue: unknown): string | null {
  if (typeof storedValue !== "string") return null;
  const trimmed = storedValue.trim();
  return /^[vV]?\d+(\.\d+)*(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(trimmed) ? trimmed : null;
}

/** The entries of `entries` (newest first) newer than the version
 *  whose news was last shown, most recent first, max 3: what the
 *  dialog shows. No usable record (fresh install, or an update from
 *  before the dialog existed) shows only the newest entry — the user
 *  missed nothing they had. A record naming this version or newer
 *  (already seen, or a downgrade) shows nothing. */
export function filterWhatsNewEntries(entries: WhatsNewEntry[], storedSeen: unknown): WhatsNewEntry[] {
  const seen = seenVersion(storedSeen);
  if (seen === null) return entries[0] ? [entries[0]] : [];
  return entries.filter((entry) => isNewer(entry.version, seen)).slice(0, 3);
}

/** The entries the dialog shows for the stored seen record. */
export function visibleWhatsNewEntries(storedSeen: unknown): WhatsNewEntry[] {
  return filterWhatsNewEntries(WHAT_S_NEW, storedSeen);
}

/** The stored seen record, or unseen when nothing is stored. Never
 *  throws. */
export function readWhatsNewSeen(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(WHATS_NEW_SEEN_KEY);
  } catch {
    return null;
  }
}

/** Record the news as shown for this version — but only forward. The
 *  dialog's close calls this on every dismiss, including a manual
 *  Help ▸ What's New open after a downgrade; writing unconditionally
 *  moved the marker down ("2.1.0" → "2.0.1") and the newer version's
 *  news auto-opened again later (BR-108). So a stored version that is
 *  already this version or newer is left alone; only no record, a
 *  garbled record, or an older version is advanced. Never throws: a
 *  record that can't be stored simply shows the news again next launch. */
export function markWhatsNewSeen(): void {
  try {
    if (typeof localStorage === "undefined") return;
    const stored = seenVersion(localStorage.getItem(WHATS_NEW_SEEN_KEY));
    if (stored !== null && !isNewer(whatsNewVersion(), stored)) return;
    localStorage.setItem(WHATS_NEW_SEEN_KEY, whatsNewVersion());
  } catch {
    // Not kept: the news appears again next launch.
  }
}
