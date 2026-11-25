// In-app "What's new" (seq 453, 2.0 launch): the visible close of the
// feedback loop — what shipped, in the app, so a user who reported
// something can see it land. One entry per release, newest first;
// Help ▸ What's New re-opens the dialog on demand, and it auto-shows
// once per version (the seen record below) after an update.
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

/** Record the news as shown for this version. Never throws: a record
 *  that can't be stored simply shows the news again next launch. */
export function markWhatsNewSeen(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(WHATS_NEW_SEEN_KEY, whatsNewVersion());
  } catch {
    // Not kept: the news appears again next launch.
  }
}
