// File names from paths, as Titer shows them (window titles, Open Recent, alerts).

/** "/a/b/Tumor.hlx" → "Tumor.hlx" */
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** "/a/b/Tumor.hlx" → "Tumor" */
export const fileTitle = (path: string) => fileName(path).replace(/\.[^.]+$/, "");

/** "/a/b/Tumor.hlx" → "/a/b" ("" for a bare file name). */
export const parentDir = (path: string) => {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
};

/** A rename / move target, or why there is none. */
export type RelocateTarget = { ok: true; path: string } | { ok: false; error: string };

/** The target of renaming `currentPath` to `newName`: the same folder, the
 *  same extension — the file's format never changes with its name. The
 *  typed name may carry the extension or not; either way the current one
 *  wins. Names that can't be a file (empty, a separator, just dots) are
 *  refused, not cleaned up silently. */
export function renameTargetPath(currentPath: string, newName: string): RelocateTarget {
  const name = newName.trim();
  if (!name) return { ok: false, error: "A file name can't be empty." };
  if (name.includes("/") || name.includes("\\"))
    return { ok: false, error: "A file name can't contain / or \\." };
  if (name === "." || name === "..") return { ok: false, error: "“.” and “..” aren't file names." };
  // A trailing dot, then any typed extension, come off; the current
  // extension goes back on. "Foo." → "Foo.hlx", "Foo.prism" → "Foo.hlx".
  const base = name.replace(/\.+$/, "").replace(/\.[^.]+$/, "");
  if (!base) return { ok: false, error: "A file name can't be empty." };
  const ext = fileName(currentPath).match(/\.[^.]+$/)?.[0] ?? "";
  const dir = parentDir(currentPath);
  return { ok: true, path: `${dir ? `${dir}/` : ""}${base}${ext}` };
}

/** The target of moving `currentPath` into `folder`: the same file name,
 *  under the new folder. */
export function moveTargetPath(currentPath: string, folder: string): RelocateTarget {
  const dir = folder.trim().replace(/[/\\]+$/, "");
  if (!dir) return { ok: false, error: "Choose a folder to move the project to." };
  return { ok: true, path: `${dir}/${fileName(currentPath)}` };
}

/** Same file? Pickers spell one file differently (case, `\` vs `/`), so
 *  compare case-insensitively with slashes unified. A false "same" only
 *  refuses a merge; a false "different" would merge a project into
 *  itself — so err toward "same". */
export const sameFilePath = (a: string, b: string) =>
  a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
