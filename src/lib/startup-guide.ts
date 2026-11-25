// The first-run startup guide (seq 454, 2.0 launch): a short skippable
// tour — import/open data → run an analysis → make a graph → export —
// then where to get help. Titer is a desktop app with no accounts and no
// login, so the guide runs on first install / first run, and Help ▸
// Startup Guide… re-opens it on demand. It must never block the app:
// skipping, dismissing or finishing all mark it seen, and it never
// reappears once seen.
//
// The seen record is a localStorage key, mirroring the Welcome dialog's
// WELCOME_KEY (src/lib/templates.ts): only an explicit "true" counts as
// seen, so no record, a garbled record or a refusal-shaped value all show
// the guide — a bad value never silently takes the tour away. The helpers
// never throw (no localStorage in tests, private mode, or a full store).

/** The localStorage key for "the startup guide has been seen". Stored as
 *  "true" once the tour is finished, skipped or dismissed; absent reads
 *  as unseen (a new user gets the tour). */
export const STARTUP_GUIDE_KEY = "titer.startup-guide-seen";

/** Titer's help/support mailbox (Smit, voice Nov 24 ~18:10 PT): Atlas's
 *  Muse Mail box. The guide's help step links it as a mailto. */
export const GUIDE_SUPPORT_EMAIL = "smit@muse.ai";

/** One tour step. `link` is the step's single way out to a human or a
 *  page — only the help step links anywhere. */
export interface GuideStep {
  id: string;
  title: string;
  body: string;
  link?: { label: string; href: string };
}

/** The tour, in order. Bodies stay short — a few steps, not a manual.
 *  The help step names the in-app feedback entry seq 453 adds (Help ▸
 *  Send Feedback) — TO-VERIFY once 453 lands — and the support mailbox. */
export const GUIDE_STEPS: GuideStep[] = [
  {
    id: "welcome",
    title: "Welcome to Titer",
    body: "Titer is a free, open-source alternative to GraphPad Prism, running entirely on your computer. This quick tour shows the path from data to a finished graph — about a minute.",
  },
  {
    id: "import",
    title: "1 · Bring your data in",
    body: "File → Import Data File… reads CSV, Excel, or text. File → Import Prism File… opens a .prism or .pzfx file. Or paste straight from Excel or Numbers into a table.",
  },
  {
    id: "analysis",
    title: "2 · Run an analysis",
    body: "With a table active, pick an analysis from the Analysis menu — a t-test, ANOVA, regression, and more. Change a value and every analysis and graph on it updates at once.",
  },
  {
    id: "graph",
    title: "3 · Make a graph",
    body: "Graph → New Graph… draws the active table. The Inspector's Format panel styles it, and View → Gallery shows every graph on one sheet.",
  },
  {
    id: "export",
    title: "4 · Export and share",
    body: "File → Export Table Data saves results as CSV, Excel, or text. File → Export All Graphs… saves every graph. Save keeps a Titer project; Save As… can write a .prism file.",
  },
  {
    id: "help",
    title: "Where to get help",
    body: "Press F1 for the User Guide, or try Help → Titer Tips. Something broken or missing? Help → Send Feedback tells us, or write to the support mailbox below.",
    link: { label: GUIDE_SUPPORT_EMAIL, href: `mailto:${GUIDE_SUPPORT_EMAIL}` },
  },
];

/** The stored seen record, forgivingly: only an explicit "true" (or
 *  true) counts as seen — anything absent, garbled or otherwise reads as
 *  unseen, so a bad value never silently takes the tour away. */
export function parseGuideSeen(value: unknown): boolean {
  return value === "true" || value === true;
}

/** Whether the guide shows: only while the record says unseen. */
export function shouldShowGuide(storedValue: unknown): boolean {
  return !parseGuideSeen(storedValue);
}

/** The stored seen record, or unseen when nothing is stored. Never throws. */
export function readGuideSeen(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return parseGuideSeen(localStorage.getItem(STARTUP_GUIDE_KEY));
  } catch {
    return false;
  }
}

/** Record the guide as seen (finished, skipped or dismissed). Never throws:
 *  a record that can't be stored simply shows the guide again next launch. */
export function markGuideSeen(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STARTUP_GUIDE_KEY, "true");
  } catch {
    // Not kept: the guide appears again next launch.
  }
}
