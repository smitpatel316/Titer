// The parts of the menu bar that don't depend on a project, shared by the project
// windows' menu bar (app-menu.ts) and the one the engine window sets while no
// project window is open (engine.ts).
import {
  alert,
  chooseProject,
  installMenuBar,
  newProject,
  openLink,
  openProjects,
  openSample,
  openSupportEmail,
  type MenuItems,
} from "./native";
import { openSendFeedback, openWhatsNew } from "./lib/feedback-ui";
import { fileName } from "./lib/paths";
import { markNewProjectWindow, NEW_PROJECT_WINDOW_KEY } from "./lib/templates";
import { checkForUpdates } from "./updates";
import { version } from "../package.json";
import { recentLabel, type RecentEntry } from "./store/recents";

export const separator = { item: "Separator" } as const;

// The icon comes from the app bundle. GitHub and Buy Me a Coffee are in the Help menu.
const COFFEE_URL = "https://www.buymeacoffee.com/smitpatel316";
// The coffee address is in the credits because the About dialog has no
// link field on macOS (AboutMetadata.website is Windows/Linux only).
// Credits are macOS-only, so Linux/Windows never saw the tagline or the
// coffee address: their native dialog renders comments and website instead
// (muda drops credits on those platforms), hence the same text here —
// comments as visible text, website as the clickable link.
// NOTE: the Mac panel in practice renders the bundle's values, not this
// metadata (v1.1 showed "Version 1.1.0 (1.1.0)" and the one-line bundle
// copyright, no credits) — so the credits that actually show on macOS
// come from src-tauri/Credits.rtf, shipped as a bundle resource. Keep
// the two in sync: this metadata for Linux/Windows, the RTF for macOS.
const ABOUT_CREDITS = `Scientific data analysis, simplified.\nBuy Me a Coffee: ${COFFEE_URL}`;
const ABOUT = {
  name: "Titer", // spelled out: in development the process is named "titer"
  version,
  // No shortVersion: Tauri renders one as "(<short>)" after the version, so an
  // empty string showed "1.0.7 ()". Omitting it shows just the version.
  credits: ABOUT_CREDITS,
  comments: ABOUT_CREDITS,
  website: COFFEE_URL,
  websiteLabel: "Buy Me a Coffee",
  copyright: "© 2026 mickaphd\nFree and open source. No warranty.",
};

/** A few things worth knowing, in-app (Help ▸ Titer Tips, seq 432): Prism's
 *  Tips open a tips page; Titer has no tips page, so the tips live here. */
const showTips = () =>
  alert(
    "Titer Tips",
    [
      "F1 opens the User Guide.",
      "Titer autosaves 10 seconds after you stop editing, and when you switch sheets or quit.",
      "Change a value and every analysis and graph on it updates at once.",
      "Paste straight from Excel or Numbers into a table.",
      "Settings → AI Connections lets an AI assistant drive Titer through MCP.",
    ].join("\n"),
    "info",
  );

/** How to cite the app (Help ▸ How to Cite Titer, seq 432): Prism's entry
 *  shows its citation; Titer's shows its own — version, address, licence,
 *  and the Zenodo DOI for this version (seq 549 Phase 2). The DOI below is
 *  the version DOI for 2.0.1 — update it on every release; it must name the
 *  version above. The concept DOI (all versions) is 10.5281/zenodo.24569160. */
const showCitation = () =>
  alert(
    "How to Cite Titer",
    `Titer ${version} (https://github.com/smitpatel316/Titer). DOI for this version: https://doi.org/10.5281/zenodo.24569161. Titer is free and open-source software under GPL-3.0, a modified fork of Helix by mickaphd. Cite the version you used and the address above.`,
    "info",
  );

/** Says a project file is gone (moved or deleted since). */
export const sayGone = (path: string) =>
  alert("Couldn't Open Project", `“${fileName(path)}” couldn't be found. It may have been moved or deleted.`, "error");

/** Opens projects (native.openProjects); one that is gone is said, and `forget` drops it. */
export function openProjectsOrSay(paths: string[], forget: (path: string) => void = () => {}) {
  openProjects(paths).catch((gone: unknown) => {
    void sayGone(String(gone));
    forget(String(gone));
  });
}

/** File ▸ New Project, Open…, Open Recent: how every File menu starts. `forgetRecent`
 *  drops a recent project that is gone. Remote entries open from the cloud
 *  (via `openRemoteEntry`); without a project window to load into, a caller
 *  passes none and remote entries are left out by filtering first. */
export function projectItems(
  recents: RecentEntry[],
  forgetRecent: (entry: RecentEntry) => void,
  clearRecents: () => void,
  openRemoteEntry?: (entry: RecentEntry) => void,
): MenuItems {
  const recentItems = recents.length
    ? [
        ...recents.map((entry) => ({
          text: recentLabel(entry),
          action: () =>
            entry.kind === "local"
              ? openProjectsOrSay([entry.path], (gone) => forgetRecent({ kind: "local", path: gone }))
              : openRemoteEntry?.(entry),
        })),
        separator,
        { text: "Clear Menu", action: clearRecents },
      ]
    : [{ text: "No Recent Projects", enabled: false }];
  return [
    {
      text: "New Project",
      accelerator: "CmdOrCtrl+N",
      // B1 (seq 167 remainder): New Project routes through Welcome — the
      // menu stamps the window it is about to open, so the new window's
      // auto-show offers the gallery instead of a bare blank table. The
      // show-on-startup setting still gates it there, and the stamp
      // expires after NEW_PROJECT_WINDOW_MS. A stamp that can't be stored
      // just means the new window opens blank, as before.
      action: () => {
        try {
          if (typeof localStorage !== "undefined") {
            localStorage.setItem(NEW_PROJECT_WINDOW_KEY, markNewProjectWindow(Date.now()));
          }
        } catch {
          // Never throw from a menu action.
        }
        void newProject();
      },
    },
    { text: "Open…", accelerator: "CmdOrCtrl+O", action: () => void chooseProject() },
    { text: "Open Recent", items: recentItems },
  ];
}

/** Sets the app's menu bar: the Titer menu, `menus`, then Window and Help.
 *  `extraHelpItems` (a project window's own Help entries, e.g. the startup
 *  guide — seq 454) land right after Titer Tips, with the rest of the
 *  in-app help; the engine window passes none. `hasProjectWindow` is false
 *  for the windowless menu: Send Feedback and What's New open dialogs that
 *  live in a project window's React tree, so with no project window open
 *  they are disabled there instead of enabled dead no-ops. */
export function setMenuBar(menus: MenuItems, extraHelpItems: MenuItems = [], hasProjectWindow = true) {
  const titer = {
    text: "Titer",
    items: [
      { item: { About: ABOUT }, text: "About Titer" },
      { text: "Check for Updates…", action: () => void checkForUpdates() },
      separator,
      { item: "Services" },
      separator,
      { item: "Hide", text: "Hide Titer" },
      { item: "HideOthers" },
      { item: "ShowAll" },
      separator,
      // The shell closes every project window first: each asks about its unsaved changes.
      { item: "Quit", text: "Quit Titer" },
    ],
  } as const;
  return installMenuBar(
    [titer, ...menus],
    [{ item: "Minimize" }, { item: "Maximize" }, separator, { item: "BringAllToFront" }],
    [
      // Prism's Help order (menus row K5, seq 432): Resources, User Guide,
      // Curve Fitting Guide, Statistics Guide, Tips, then How to Cite,
      // then the support entries, then the vendor site. Manage License is
      // N/A — open source, no licence — and is deliberately absent. The two
      // Prism guides are GraphPad's own documentation, labelled as Prism's;
      // Titer has no equivalent of its own to point at. Check for Updates
      // already lives in the Titer menu, and Free Web QuickCalcs has no
      // Titer equivalent, so neither is repeated here.
      // The support block (seq 453) is the feedback loop: Send Feedback
      // opens the in-app dialog (no AI, no browser); Contact Support
      // writes to smit@muse.ai; Ask the Community opens the repo's
      // GitHub Discussions; What's New shows what shipped from feedback.
      // The pre-filled GitHub-issue entry (seq 432) is gone: GitHub
      // Issues are off on the repo, so the link was dead.
      { text: "Titer on GitHub", action: () => openLink("github") },
      // The user guide lives in the repo's README (Help ▸ Titer User Guide,
      // seq 241): the same fixed address as the GitHub link, opened the
      // same way — the shell only ever opens fixed addresses.
      { text: "Titer User Guide", accelerator: "F1", action: () => openLink("guide") },
      { text: "Prism Curve Fitting Guide", action: () => openLink("curve-fitting") },
      { text: "Prism Statistics Guide", action: () => openLink("statistics") },
      { text: "Titer Tips", action: () => void showTips() },
      ...extraHelpItems,
      separator,
      { text: "How to Cite Titer", action: () => void showCitation() },
      separator,
      { text: "Send Feedback", enabled: hasProjectWindow, action: () => openSendFeedback() },
      { text: "Contact Support", action: () => void openSupportEmail() },
      { text: "Ask the Community", action: () => openLink("discussions") },
      { text: "Support Web Site", action: () => openLink("support") },
      { text: "Support Policies", action: () => openLink("support-policies") },
      { text: "What's New", enabled: hasProjectWindow, action: () => openWhatsNew() },
      separator,
      { text: "Go to titer.smitpatel.net", action: () => openLink("site") },
      { text: "Buy Me a Coffee", action: () => openLink("coffee") },
      separator,
      { text: "Sample Project", action: () => void openSample() },
    ],
  );
}
