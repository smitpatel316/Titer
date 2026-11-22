// File ▸ Revert to Saved (Plane seq 306, Prism menus B11): the pure half.
// The command itself lives in src/store/use-document.ts (`revertToSaved`);
// this module holds what checks.ts can pin without a window — when the
// command is enabled, how an externally changed file is detected, and the
// exact wording of the two confirm dialogs.
//
// The versions store (seq 226) is the enabler, but Revert reads the saved
// file itself: the backup holds unsaved work, and reverting means taking
// the file on disk as it stands, not the last backup.
import { isTemplatePath } from "./template";
import { PROJECT_FILE_EXTENSION } from "./project-file";

/** What the enablement rule reads: the dirty flag, the local path (null
 *  for untitled and for remote files), and whether the project lives in
 *  the cloud instead. */
export interface RevertTarget {
  isDirty: boolean;
  filePath: string | null;
  remote: boolean;
}

/** Whether a local path can be reloaded as a project: a `.hlx` project
 *  file, or a `.pzt` template (`.hlx` JSON with a template envelope — the
 *  loader reads both). A `.prism` / `.pzfx` file is NOT reloadable: opening
 *  one is an import, and import is lossy (graphs and analyses don't all
 *  survive), so reverting to one would silently drop work — the command
 *  stays disabled for those instead. Case-insensitive, like the opener. */
export function isReloadableProjectPath(path: string | null): boolean {
  if (!path) return false;
  return path.toLowerCase().endsWith(`.${PROJECT_FILE_EXTENSION}`) || isTemplatePath(path);
}

/** The menu enablement: dirty, and a save to go back to — a reloadable
 *  local file, or a remote one. Clean or untitled is disabled, and so is a
 *  dirty project whose file can't be reloaded (see above). */
export function canRevertToSaved(target: RevertTarget): boolean {
  if (!target.isDirty) return false;
  if (target.remote) return true;
  return isReloadableProjectPath(target.filePath);
}

/** The plain confirm's wording (from the Plane scope, verbatim). */
export const REVERT_CONFIRM_TITLE = "Revert to Saved";
export const REVERT_CONFIRM_DETAIL = "Discard unsaved changes and revert to the last saved version?";

/** The externally-changed file's title: the file was rewritten by another
 *  program since this window opened or saved it, so the version on disk is
 *  no longer the last saved version — the dialog says so, rather than the
 *  plain confirm's "last saved version". */
export function revertExternalChangeTitle(fileName: string): string {
  return `“${fileName}” Changed on Disk`;
}

/** The externally-changed file's detail: what changed, and what reverting
 *  takes — the version on disk now, with the unsaved changes discarded. */
export function revertExternalChangeDetail(fileName: string): string {
  return `“${fileName}” was changed by another program since you opened it. Reverting takes the version on disk now and discards your unsaved changes.`;
}

/** Whether the file on disk changed externally since this window last
 *  read or wrote it: the disk text differs from the text last saved or
 *  loaded. An unreadable disk (`null`) or an unknown baseline (`null` —
 *  a format whose bytes can't be compared) never claims a change: the
 *  reload reports those itself, and a false "changed" would cry wolf. */
export function diskChangedExternally(diskText: string | null, lastSavedText: string | null): boolean {
  if (diskText === null || lastSavedText === null) return false;
  return diskText !== lastSavedText;
}
