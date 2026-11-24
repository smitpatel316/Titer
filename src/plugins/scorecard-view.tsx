// Safety scorecard view — marketplace M3 (seq 435).
//
// Renders a `SafetyScorecard` (scorecard.ts) on a listing page (M2):
// the score, the verdict, and — the point of the component — every
// input with its weight and whether it was earned, so the number is
// never opaque. A failed verdict also says plainly that the plugin
// cannot be installed until its gates pass.

import type { SafetyScorecard } from "./scorecard";

const VERDICT_LABEL: Record<SafetyScorecard["verdict"], string> = {
  pass: "Safe to install",
  caution: "Install with care",
  fail: "Does not pass the gates",
};

export function SafetyScorecardView({ scorecard }: { scorecard: SafetyScorecard }) {
  return (
    <section
      aria-label="Safety scorecard"
      className="flex flex-col gap-2 rounded-lg bg-control p-3 ring-1 ring-separator"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-primary">Safety scorecard</h3>
        <span className="text-sm text-primary">
          {scorecard.score} / {scorecard.maxScore} — {VERDICT_LABEL[scorecard.verdict]}
        </span>
      </div>
      {scorecard.verdict === "fail" && (
        <p className="text-sm text-primary">
          This version does not pass the automated gates, so it cannot be installed until its author fixes it.
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {scorecard.items.map((item) => (
          <li key={item.key} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-primary">
              {item.earned ? "✓" : "✗"} {item.label}
            </span>
            <span className="shrink-0 text-secondary">
              {item.earned ? item.weight : 0} / {item.weight}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-secondary">
        {scorecard.license === null
          ? "No license recorded."
          : `License: ${scorecard.license} (recorded as-is — Titer does not judge licenses.)`}
      </p>
      <p className="text-xs text-secondary">
        The gates are a tripwire, not a sandbox proof: plugins run behind a capability boundary, not a sandbox.
      </p>
    </section>
  );
}
