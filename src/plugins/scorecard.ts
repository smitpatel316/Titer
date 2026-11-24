// Safety scorecard — marketplace M3 (seq 435).
//
// A pure function: gate results + listing metadata → a listing
// scorecard (Obsidian shape). The scoring is transparent by design —
// the scorecard shows every input, its weight, and whether it was
// earned, not just a number. The listing page (M2) renders it with
// `SafetyScorecardView` (scorecard-view.tsx).
//
// Weights (total 100): gates 40, own suite 20, README 10, screenshots 5,
// version history 10, publisher verified 15. Verdict: `fail` whenever
// any gate failed, whatever the listing shows; otherwise `pass` at 80+,
// `caution` below that.

import type { GateReport } from "./gates";

/** What the listing contributes to the scorecard (M2 supplies this from
 *  the index entry: README/screenshots/version history present, and
 *  whether the publisher carries the verified badge). */
export interface ScorecardListing {
  readmePresent: boolean;
  screenshotsPresent: boolean;
  versionHistoryPresent: boolean;
  publisherVerified: boolean;
}

/** One scored input, shown on the listing page as-is. */
export interface ScorecardItem {
  key: "gates" | "own-suite" | "readme" | "screenshots" | "version-history" | "publisher";
  label: string;
  weight: number;
  earned: boolean;
  detail: string;
}

export interface SafetyScorecard {
  score: number;
  maxScore: number;
  verdict: "pass" | "caution" | "fail";
  items: ScorecardItem[];
  /** The license string, recorded verbatim (never judged). */
  license: string | null;
}

/** The weights, exported so the listing page and the pins can show the
 *  arithmetic instead of asserting a magic number. */
export const SCORECARD_WEIGHTS = {
  gates: 40,
  "own-suite": 20,
  readme: 10,
  screenshots: 5,
  "version-history": 10,
  publisher: 15,
} as const;

export const SCORECARD_MAX = Object.values(SCORECARD_WEIGHTS).reduce((a, b) => a + b, 0);

/** Build the scorecard. `gates` is the `runPluginGates` report for the
 *  exact version being listed; `listing` is the index entry's metadata. */
export function computeSafetyScorecard(gates: GateReport, listing: ScorecardListing): SafetyScorecard {
  const ownSuite = gates.gates.find((g) => g.id === "own-suite");
  const items: ScorecardItem[] = [
    {
      key: "gates",
      label: "Automated gates passed",
      weight: SCORECARD_WEIGHTS.gates,
      earned: gates.passed,
      detail: gates.passed
        ? "Manifest, static scan, own suite and license recording all passed."
        : "One or more automated gates failed — see the gate report.",
    },
    {
      key: "own-suite",
      label: "Plugin passes its own checks",
      weight: SCORECARD_WEIGHTS["own-suite"],
      earned: ownSuite?.passed ?? false,
      detail:
        (ownSuite?.passed ?? false)
          ? (ownSuite?.detail ?? "The plugin's own checks passed.")
          : "The plugin did not pass its own checks.",
    },
    {
      key: "readme",
      label: "README present",
      weight: SCORECARD_WEIGHTS.readme,
      earned: listing.readmePresent,
      detail: listing.readmePresent ? "The listing includes a README." : "No README in the listing.",
    },
    {
      key: "screenshots",
      label: "Screenshots present",
      weight: SCORECARD_WEIGHTS.screenshots,
      earned: listing.screenshotsPresent,
      detail: listing.screenshotsPresent ? "The listing includes screenshots." : "No screenshots in the listing.",
    },
    {
      key: "version-history",
      label: "Version history present",
      weight: SCORECARD_WEIGHTS["version-history"],
      earned: listing.versionHistoryPresent,
      detail: listing.versionHistoryPresent
        ? "Earlier versions are listed, so a known-good version can be pinned."
        : "No version history in the listing.",
    },
    {
      key: "publisher",
      label: "Publisher verified",
      weight: SCORECARD_WEIGHTS.publisher,
      earned: listing.publisherVerified,
      detail: listing.publisherVerified
        ? "The publisher carries the verified badge."
        : "The publisher is not verified — install only if you trust the author.",
    },
  ];
  const score = items.reduce((sum, item) => sum + (item.earned ? item.weight : 0), 0);
  const verdict: SafetyScorecard["verdict"] = !gates.passed ? "fail" : score >= 80 ? "pass" : "caution";
  return { score, maxScore: SCORECARD_MAX, verdict, items, license: gates.license };
}
