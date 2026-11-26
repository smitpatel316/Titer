// Whether a newer Titer is out, and installing it in place: the channel
// manifest (src/lib/channel.ts) against this version. Checked quietly at
// launch (at most once a day) and from Titer ▸ Check for Updates….
// "Update Now" downloads the release, checks it, swaps the app bundle in,
// and relaunches; the second launch is quiet. On Linux, or when no
// installable asset is published, the offer opens the releases page
// instead — the manual download Titer used to do for every platform.
import {
  alert,
  appVersion,
  applyUpdate,
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

/** `quiet`: say something only when a newer version is out (the launch check).
 *  Returns whether the check reached a decision (an offer, up-to-date, or
 *  paused): false when it never got an answer (offline with nothing cached),
 *  so the daily check can try again on the next launch instead of consuming
 *  the day (CC-m8). */
export async function checkForUpdates(quiet = false): Promise<boolean> {
  if (!isNative) return false;
  // The channel fetch's failure reason, captured while it is from this
  // check: the catch below shows it instead of only blaming the
  // connection (the P0's fetch failed while the network was fine).
  let channelError: string | null = null;
  try {
    const current = await appVersion();
    const manifest = await fetchChannelManifest();
    channelError = lastChannelFetchError();
    if (manifest) {
      await checkAgainstManifest(current, manifest, quiet);
      return true;
    }
    // No channel yet (or offline with nothing cached): the branch's
    // package.json, as before — an optional offer and a manual download.
    const latest = await latestVersion();
    if (typeof latest === "string" && isNewer(latest, current)) {
      if (await askToUpdate(latest.replace(/^v/i, ""), false, false)) openLink("releases");
    } else if (!quiet) {
      await alert("Titer is up to date", `Version ${current} is the latest.`, "info");
    }
    return true;
  } catch (err) {
    if (!quiet) {
      const detail = channelError
        ? `Could not reach the update channel (${channelError}) or GitHub (${String(err)}). Check your internet connection and try again.`
        : `${String(err)} Check your internet connection and try again.`;
      await alert("Couldn't Check for Updates", detail);
    }
    return false;
  }
}

async function checkAgainstManifest(current: string, manifest: ChannelManifest, quiet: boolean) {
  const state = decideUpdate(current, manifest);
  if (state.kind === "quiet") {
    if (!quiet) await alert("Titer is up to date", `Version ${current} is the latest.`, "info");
    return;
  }
  if (state.kind === "disabled") {
    await alert("Titer Updates Paused", state.message, "info");
    return;
  }
  if (!(await askToUpdate(state.version, state.kind === "forced", isMacOs() && manifest.update !== undefined))) return;
  await installUpdate(state.version, manifest, state.kind === "forced");
}

/** Downloads the release, checks it, and restarts into it. A failure
 *  offers the manual download on an optional update; on a forced one
 *  there is no usable app state without the update, so it offers another
 *  try, or quits. */
async function installUpdate(version: string, manifest: ChannelManifest, forced: boolean): Promise<void> {
  const asset = manifest.update;
  if (!asset) {
    // No installable asset published (Linux today): the manual download.
    openLink("releases");
    return;
  }
  try {
    // The shell resolves the asset strictly from the channel manifest
    // itself (Round 2 Issue 46): the page passes no URL, hash, or size.
    // `asset` is still the guard that an installable asset exists at
    // all — without it, the manual download.
    const path = await downloadUpdate();
    await alert("Update Downloaded", `Titer ${version} is ready. Titer will restart to install it.`, "info");
    await applyUpdate(path, version);
    // The helper swaps the bundle once this process exits; quit through
    // the normal flow, so unsaved work still gets its save prompt. If the
    // user cancels the quit, the helper gives up and the next launch
    // offers the update again — nothing is half-installed.
    await quitApp();
  } catch (err) {
    if (forced) {
      if (await askToRetryUpdate(version, String(err))) await installUpdate(version, manifest, true);
      else await quitApp();
    } else {
      await alert(
        "Couldn't Install the Update",
        `${String(err)} You can still download it from GitHub and replace Titer in your Applications folder.`,
        "warning",
      );
      openLink("releases");
    }
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
