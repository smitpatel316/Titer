// Whether a newer Titer is out, and installing it in place: the channel
// manifest (src/lib/channel.ts) against this version. Checked quietly at
// launch (at most once a day) and from Titer ▸ Check for Updates….
// "Update Now" downloads the release, checks it, swaps the app bundle in,
// and relaunches; the second launch is quiet. On Linux, or when no
// installable asset is published, the offer opens the releases page
// instead — the manual download Titer used to do for every platform.
//
// Nov 27 2026 (2.0.3): Check for Updates failed on every run and took
// the user to GitHub instead. The channel was healthy and named a 2.0.3
// zip — but the zip was stamped 2.0.1 (package.json was never bumped for
// 2.0.2/2.0.3), so the shell's version-stamp guard refused the swap and
// the install-failure branch opened the releases page without asking.
// Two fixes: the version pins are bumped with every release (so the
// stamp matches the manifest), and a failed install now explains itself
// and offers the manual download as an explicit choice — GitHub opens
// only when the user says so, or when the channel itself is unreachable
// (the last-resort fallback below).
import {
  alert,
  appVersion,
  applyUpdate,
  askToDownloadManually,
  askToRetryUpdate,
  askToUpdate,
  downloadUpdate,
  isNative,
  openLink,
  quitApp,
} from "./native";
import { decideUpdate, fetchChannelManifest, isMacOs, lastChannelFetchError, type ChannelManifest } from "./lib/channel";
import { isNewer, latestVersion } from "./lib/version";

const CHECKED_KEY = "titer.updatesCheckedAt";
const DAY = 24 * 60 * 60 * 1000;

/** The seams checkForUpdates runs through, so the tests can drive the
 *  whole flow — offer, install, failure — without a shell. Production
 *  passes the real native/channel functions; the tests pass fakes. */
export interface UpdateDeps {
  isNative: boolean;
  isMacOs: () => boolean;
  appVersion: () => Promise<string>;
  fetchChannelManifest: () => Promise<ChannelManifest | null>;
  lastChannelFetchError: () => string | null;
  latestVersion: () => Promise<unknown>;
  askToUpdate: (version: string, forced: boolean, installable: boolean, manualReason?: string) => Promise<boolean>;
  askToDownloadManually: (version: string, detail: string) => Promise<boolean>;
  askToRetryUpdate: (version: string, detail: string) => Promise<boolean>;
  downloadUpdate: () => Promise<string>;
  applyUpdate: (path: string, version: string) => Promise<string>;
  openLink: (link: "releases") => void;
  alert: (title: string, message: string, kind?: "info" | "warning" | "error") => Promise<void>;
  quitApp: () => Promise<unknown>;
}

const defaultDeps: UpdateDeps = {
  isNative,
  isMacOs,
  appVersion,
  fetchChannelManifest,
  lastChannelFetchError,
  latestVersion,
  askToUpdate,
  askToDownloadManually,
  askToRetryUpdate,
  downloadUpdate,
  applyUpdate,
  openLink,
  alert,
  quitApp,
};

/** `quiet`: say something only when a newer version is out (the launch check).
 *  Returns whether the check reached a decision (an offer, up-to-date, or
 *  paused): false when it never got an answer (offline with nothing cached),
 *  so the daily check can try again on the next launch instead of consuming
 *  the day (CC-m8). */
export async function checkForUpdates(quiet = false, deps: UpdateDeps = defaultDeps): Promise<boolean> {
  if (!deps.isNative) return false;
  // The channel fetch's failure reason, captured while it is from this
  // check: the catch below shows it instead of only blaming the
  // connection (the P0's fetch failed while the network was fine).
  let channelError: string | null = null;
  try {
    const current = await deps.appVersion();
    const manifest = await deps.fetchChannelManifest();
    channelError = deps.lastChannelFetchError();
    if (manifest) {
      await checkAgainstManifest(current, manifest, quiet, deps);
      return true;
    }
    // No channel yet (or offline with nothing cached): the branch's
    // package.json, as before — an optional offer and a manual download.
    // This is the ONLY path that opens GitHub without an in-place
    // update to offer: the channel itself is unreachable, so there is
    // nothing to install in place, and the dialog says so.
    const latest = await deps.latestVersion();
    if (typeof latest === "string" && isNewer(latest, current)) {
      const reason = channelError
        ? `The update channel couldn't be reached (${channelError}), so Titer can't check for an in-place update.`
        : "The update channel couldn't be reached, so Titer can't check for an in-place update.";
      if (await deps.askToUpdate(latest.replace(/^v/i, ""), false, false, reason)) deps.openLink("releases");
    } else if (!quiet) {
      await deps.alert("Titer is up to date", `Version ${current} is the latest.`, "info");
    }
    return true;
  } catch (err) {
    if (!quiet) {
      const detail = channelError
        ? `Could not reach the update channel (${channelError}) or GitHub (${String(err)}). Check your internet connection and try again.`
        : `${String(err)} Check your internet connection and try again.`;
      await deps.alert("Couldn't Check for Updates", detail);
    }
    return false;
  }
}

async function checkAgainstManifest(current: string, manifest: ChannelManifest, quiet: boolean, deps: UpdateDeps) {
  const state = decideUpdate(current, manifest);
  if (state.kind === "quiet") {
    if (!quiet) await deps.alert("Titer is up to date", `Version ${current} is the latest.`, "info");
    return;
  }
  if (state.kind === "disabled") {
    await deps.alert("Titer Updates Paused", state.message, "info");
    return;
  }
  if (!(await deps.askToUpdate(state.version, state.kind === "forced", deps.isMacOs() && manifest.update !== undefined))) return;
  await installUpdate(state.version, manifest, state.kind === "forced", deps);
}

/** Downloads the release, checks it, and restarts into it. A failure
 *  offers the manual download on an optional update; on a forced one
 *  there is no usable app state without the update, so it offers another
 *  try, or quits. */
async function installUpdate(version: string, manifest: ChannelManifest, forced: boolean, deps: UpdateDeps): Promise<void> {
  const asset = manifest.update;
  if (!asset) {
    // No installable asset published: on Linux that is the manual
    // download the prompt already promised (Update Now was the consent).
    // On macOS it is unexpected with a healthy channel — say so, and
    // let the user choose the manual download instead of opening it.
    if (!deps.isMacOs()) {
      deps.openLink("releases");
      return;
    }
    await deps.alert(
      "No In-Place Update Available",
      `Titer ${version} is out, but the update channel names no installable app for macOS yet.`,
      "warning",
    );
    if (await deps.askToDownloadManually(version, "the channel names no installable update for this version")) {
      deps.openLink("releases");
    }
    return;
  }
  try {
    // The shell resolves the asset strictly from the channel manifest
    // itself (Round 2 Issue 46): the page passes no URL, hash, or size.
    // `asset` is still the guard that an installable asset exists at
    // all — without it, the manual download.
    const path = await deps.downloadUpdate();
    await deps.alert("Update Downloaded", `Titer ${version} is ready. Titer will restart to install it.`, "info");
    await deps.applyUpdate(path, version);
    // The helper swaps the bundle once this process exits; quit through
    // the normal flow, so unsaved work still gets its save prompt. If the
    // user cancels the quit, the helper gives up and the next launch
    // offers the update again — nothing is half-installed.
    await deps.quitApp();
  } catch (err) {
    const detail = String(err);
    if (forced) {
      if (await deps.askToRetryUpdate(version, detail)) {
        await installUpdate(version, manifest, true, deps);
        return;
      }
      // No retry: the manual download is the last way in — offered,
      // not opened — and then the app quits, as a forced update must.
      if (await deps.askToDownloadManually(version, detail)) deps.openLink("releases");
      await deps.quitApp();
      return;
    }
    // A failed install no longer opens GitHub on its own (2.0.3: the
    // stamp guard refused a 2.0.1-stamped zip and the user landed on
    // the releases page with no explanation). Say what failed, and
    // open the manual download only if the user asks for it.
    await deps.alert("Couldn't Install the Update", detail, "warning");
    if (await deps.askToDownloadManually(version, detail)) deps.openLink("releases");
  }
}

/** The launch check, at most once a day. The key is written only after the
 *  check settles with a decision (CC-m8): writing it first suppressed the
 *  re-check for 24 h even when the check hung — and with the 10 s timeout
 *  a hung check now settles instead of hanging forever. A check that never
 *  reached a decision leaves the key alone, so the next launch tries again.
 *  `runCheck` is the seam the tests drive; production passes the real check. */
export function checkForUpdatesDaily(runCheck: () => Promise<boolean> = () => checkForUpdates(true)) {
  try {
    if (Date.now() - Number(localStorage.getItem(CHECKED_KEY)) < DAY) return;
  } catch {
    // no storage: check anyway
  }
  void runCheck().then(
    (completed) => {
      if (!completed) return;
      try {
        localStorage.setItem(CHECKED_KEY, String(Date.now()));
      } catch {
        // no storage: nothing to remember
      }
    },
    () => {
      // A check that threw instead of answering is no decision either.
    },
  );
}
