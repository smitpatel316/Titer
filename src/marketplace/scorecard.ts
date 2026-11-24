// Safety scorecard slot (M3 renders it). M2 only carries the typed slot
// through the index and the listing UI — a listing with no scorecard yet
// shows "pending", never a made-up score.

export type ScorecardStatus = "pending" | "passed" | "flagged";

export interface ScorecardSummary {
  status: ScorecardStatus;
  /** One line per gate (e.g. "Manifest valid", "Static scan: 0 findings"). */
  lines: string[];
}

/** What a listing shows before M3's gates exist: pending, honestly. */
export const PENDING_SCORECARD: ScorecardSummary = {
  status: "pending",
  lines: ["Safety scorecard pending — the automated gates run in M3."],
};
