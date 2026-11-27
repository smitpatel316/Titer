import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProjectProvider } from "./store/use-project-store";
import { LayoutProvider } from "./store/use-layout";
import { AppShell } from "./components/app-shell";
import { connectR } from "./stats/webr";
import { accentColor, cancelR, evalR, isNative, mcpFlushErrorLog, onEngineReset, onFocusChange, setSpinner } from "./native";
import { checkForUpdatesDaily } from "./updates";
import { installErrorCapture } from "./lib/error-log";
import { getMarketplaceStore } from "./marketplace/wiring";
import "./styles.css";

// Highlights take the accent color chosen in System Settings, read again whenever
// the window comes to the front (it can only change while System Settings is).
const syncAccent = () =>
  void accentColor().then((color) => color && document.documentElement.style.setProperty("--accent", color));
onFocusChange((focused) => focused && syncAccent());

// Analyses run in the app's one R, in the engine window (engine.ts). In a plain
// browser (`npm run web`), this page starts its own R at the first analysis.
// `cancelR` is the watchdog's / Cancel button's way to stop that R.
if (isNative) connectR(evalR, cancelR);
// The engine window (re)starting voids this window's installed-package
// states (R3-02): listen for its broadcast, so the next analysis
// reinstalls instead of failing with `there is no package called '…'`.
void onEngineReset();
// A wheel left by a page reloaded while an analysis ran (the window keeps it) goes.
if (isNative) setSpinner(null);

// Whether a newer Titer is out, at most once a day.
checkForUpdatesDaily();

// Opt-in anonymous error logging (seq 452): capture uncaught exceptions
// and unhandled rejections from here on, and send any unsent entries from
// a previous run (e.g. a crash) — only when the user opted in to
// error-report sharing; otherwise everything stays on this Mac.
if (isNative) {
  installErrorCapture();
  void mcpFlushErrorLog().catch(() => {
    // A failed flush is not itself an error to report.
  });
}

// The marketplace store is created at startup, not only when the dialog
// opens: installed+enabled plugins re-register their analyses into the
// registry on launch (seq 461), so the picker and MCP see them. A failure
// here must never break startup — the dialog reports it plainly.
// Seq 518: the mount waits for that hydration. Firing it fire-and-forget
// let a restored plugin analysis sheet (or an early MCP call) race the
// store's dynamic import() + appVersion() and permanently render
// "Unknown plugin analysis: plugin:..." — the registry resolves an
// analysis id once, at sheet open, and never retries.
async function mount(): Promise<void> {
  try {
    await getMarketplaceStore();
  } catch {
    // A failed hydration must never break startup — the dialog reports it plainly.
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ProjectProvider>
        <LayoutProvider>
          <AppShell />
        </LayoutProvider>
      </ProjectProvider>
    </StrictMode>,
  );
}

void mount();
