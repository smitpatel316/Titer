// The parts of the menu bar that don't depend on a project, shared by the project
// windows' menu bar (app-menu.ts) and the one the engine window sets while no
// project window is open (engine.ts).
import {
  alert,
  chooseProject,
  installMenuBar,
  newProject,
  openGithubIssue,
  openLink,
  openProjects,
  openSample,
  type MenuItems,
} from "./native";
import { fileName } from "./lib/paths";
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
 *  shows its citation; Titer's shows its own — version, address, licence. */
const showCitation = () =>
  alert(
    "How to Cite Titer",
    `Titer ${version} (https://github.com/smitpatel316/Titer). Titer is free and open-source software under GPL-3.0, a modified fork of Helix by mickaphd. Cite the version you used and the address above.`,
    "info",
  );

/** A pre-filled support issue (Help ▸ Personal Support…, seq 432): the
 *  shell only opens the fixed issues/new address, so the title and body
 *  are the only free text — the same shape as the feedback issue. */
const supportIssueUrl = () =>
  `https://github.com/smitpatel316/Titer/issues/new?title=${encodeURIComponent("Support request")}&body=${encodeURIComponent(
    "Titer version:\nOperating system:\n\nWhat happened?\n\n\nWhat did you expect?\n\n\nSteps to reproduce:\n",
  )}`;

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
    { text: "New Project", accelerator: "CmdOrCtrl+N", action: () => void newProject() },
    { text: "Open…", accelerator: "CmdOrCtrl+O", action: () => void chooseProject() },
    { text: "Open Recent", items: recentItems },
  ];
}

/** Sets the app's menu bar: the Titer menu, `menus`, then Window and Help.
 *  `extraHelpItems` (a project window's own Help entries, e.g. the startup
 *  guide — seq 454) land right after Titer Tips, with the rest of the
 *  in-app help; the engine window passes none. */
export function setMenuBar(menus: MenuItems, extraHelpItems: MenuItems = []) {
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
      { text: "Support Web Site", action: () => openLink("support") },
      { text: "Personal Support…", action: () => void openGithubIssue(supportIssueUrl()) },
      { text: "Support Policies", action: () => openLink("support-policies") },
      separator,
      { text: "Go to titer.smitpatel.net", action: () => openLink("site") },
      { text: "Buy Me a Coffee", action: () => openLink("coffee") },
      separator,
      { text: "Sample Project", action: () => void openSample() },
    ],
  );
}
