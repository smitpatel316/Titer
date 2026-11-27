// The hidden "engine" window, open as long as Titer is: the app's one R, which
// every project window uses, and the menu bar while no project window is open.
import { evalNamedVector, getEngineBootStatus, onEngineBootStatus, onEngineStuck, startR } from "./stats/webr";
import { cancelR, onEngineBootStatusRequest, onNoWindows, publishEngineBootStatus, serveR } from "./native";
import { projectItems, setMenuBar } from "./menus";
import { loadRecents, saveRecents, recentKey, type RecentEntry } from "./store/recents";

// Publish every boot-status change to project windows (CC-m7) —
// subscribed BEFORE the boot starts, so a fast failure is published too.
// A failed boot is recorded as the engine boot status (webr.ts), not
// swallowed: the first request still retries the boot, which reports it too.
onEngineBootStatus((status) => publishEngineBootStatus(status));
void onEngineBootStatusRequest(() => publishEngineBootStatus(getEngineBootStatus()));
startR().catch(() => {});
void serveR(evalNamedVector);

/** A calculation the interrupt could not free: this window's R is wedged, so
 *  drop the shell's waiting requests (or the hung code is re-sent when this
 *  window says it is ready) and reload — a fresh page boots a fresh R, and
 *  the wedged worker dies with the old page. The timed reload covers the
 *  shell call not landing before the first reload. */
onEngineStuck(() => {
  void cancelR().finally(() => window.location.reload());
  setTimeout(() => window.location.reload(), 2000);
});

/** With no project open, Titer stays open (as Pages does) with a menu bar to open one. */
function setWindowlessMenuBar() {
  const keepRecents = (entries: RecentEntry[]) => {
    saveRecents(entries);
    setWindowlessMenuBar();
  };
  const recents = loadRecents();
  const forgetRecent = (entry: RecentEntry) => keepRecents(recents.filter((e) => recentKey(e) !== recentKey(entry)));
  // Local files only: a remote file needs a project window to load into,
  // and there is none while this menu is showing. Remote recents open from
  // a project window's File menu instead. No project window is open, so
  // the dialog Help items (Send Feedback, What's New) are disabled —
  // the engine window has no React tree to open them into.
  const local = recents.filter((e): e is Extract<RecentEntry, { kind: "local" }> => e.kind === "local");
  void setMenuBar([{ text: "File", items: projectItems(local, forgetRecent, () => keepRecents([])) }], [], false);
}
onNoWindows(setWindowlessMenuBar);
