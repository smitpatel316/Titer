// File names from paths, as Titer shows them (window titles, Open Recent, alerts).

/** "/a/b/Tumor.hlx" → "Tumor.hlx" */
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** "/a/b/Tumor.hlx" → "Tumor" */
export const fileTitle = (path: string) => fileName(path).replace(/\.[^.]+$/, "");

/** Same file? Pickers spell one file differently (case, `\` vs `/`), so
 *  compare case-insensitively with slashes unified. A false "same" only
 *  refuses a merge; a false "different" would merge a project into
 *  itself — so err toward "same". */
export const sameFilePath = (a: string, b: string) =>
  a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
