// Linked paste (Prism 11, seq 168): the UI entry points the grid, the
// table view and project-open share — pick a source file, paste it as a
// link, refresh a table's link from its source. The pure engine lives in
// src/lib/linked-paste.ts; this is the file-picking and file-reading half
// (native shell on desktop, a file input on the web build).
import { chooseDataFile, isNative, onDataFilePicked, readLinkedSource } from "../../native";
import { fileName } from "../../lib/paths";
import {
  applyLinkedBlock,
  isLinkedSourcePath,
  linkedPasteKindOf,
  parseLinkedSource,
  refreshLinked,
  type LinkedPaste,
} from "../../lib/linked-paste";
import type { TableData, TableType } from "../../store/types";

/** The paste of `block` as a link at (row, col): the values land, the link
 *  is stored — even when the values already match, so pasting a link over
 *  identical cells still links them. `changed` is false only when the table
 *  already carried this exact link over these exact values. */
function applyPasteLink(
  data: TableData,
  type: TableType,
  row: number,
  col: number,
  sourcePath: string,
  sourceName: string,
  autoUpdate: boolean,
  block: (string | null)[][],
): { data: TableData; changed: boolean; droppedColumns: number } {
  const width = block.reduce((w, r) => Math.max(w, r.length), 0);
  const link: LinkedPaste = {
    sourcePath,
    sourceName,
    kind: linkedPasteKindOf(sourceName),
    row,
    col,
    rows: block.length,
    cols: width,
    autoUpdate,
  };
  const res = applyLinkedBlock(data, link, block, type);
  if (res.changed) return res;
  if (JSON.stringify(data.linkedPaste) === JSON.stringify(link)) {
    return { data, changed: false, droppedColumns: 0 };
  }
  return { data: { ...data, linkedPaste: link }, changed: true, droppedColumns: 0 };
}

/** Paste the file at `sourcePath` as a link at (row, col). Throws a
 *  user-facing message when the file can't be read or holds no data. */
export async function pasteLinkFromPath(
  data: TableData,
  type: TableType,
  row: number,
  col: number,
  sourcePath: string,
  autoUpdate = true,
): Promise<{ data: TableData; changed: boolean; droppedColumns: number }> {
  const sourceName = fileName(sourcePath);
  let content: string | Uint8Array;
  try {
    content = await readLinkedSource(sourcePath, linkedPasteKindOf(sourcePath));
  } catch {
    throw new Error(`“${sourceName}” couldn't be read.`);
  }
  return applyPasteLink(
    data,
    type,
    row,
    col,
    sourcePath,
    sourceName,
    autoUpdate,
    await parseLinkedSource(sourceName, content),
  );
}

/** Paste already-read contents as a link (the web build's file input — no
 *  path on disk, so the link stores the file's name and a refresh needs the
 *  desktop app). Throws a user-facing message when the file holds no data. */
export async function pasteLinkFromContent(
  data: TableData,
  type: TableType,
  row: number,
  col: number,
  sourceName: string,
  content: string | Uint8Array,
  autoUpdate = true,
): Promise<{ data: TableData; changed: boolean; droppedColumns: number }> {
  return applyPasteLink(
    data,
    type,
    row,
    col,
    sourceName,
    sourceName,
    autoUpdate,
    await parseLinkedSource(sourceName, content),
  );
}

/** Refresh `data`'s link from its source file. Throws a user-facing message
 *  when the table has no link, or the source can't be read or parsed. */
export async function refreshLinkedFromFile(
  data: TableData,
  type: TableType,
): Promise<{ data: TableData; changed: boolean; droppedColumns: number }> {
  const link = data.linkedPaste;
  if (!link) throw new Error("This table has no linked data — paste a file as a link first (Edit ▸ Paste Link…).");
  let content: string | Uint8Array;
  try {
    content = await readLinkedSource(link.sourcePath, link.kind);
  } catch {
    throw new Error(`“${link.sourceName}” couldn't be read — the file may have moved or been deleted.`);
  }
  return refreshLinked(data, link, content, type);
}

/** Pick a source file for a link: the native Open panel on desktop, a file
 *  input on the web build. Resolves null on Cancel. A desktop pick is a
 *  path (refresh re-reads it); a web pick is the file's contents (there is
 *  no path to re-read). */
export async function pickLinkedSource(): Promise<
  { path: string } | { name: string; content: string | Uint8Array } | null
> {
  if (isNative) {
    const picked = await new Promise<string | null>((resolve) => {
      void (async () => {
        const off = await onDataFilePicked((path) => {
          off();
          resolve(path);
        });
        await chooseDataFile();
      })();
    });
    if (!picked || !isLinkedSourcePath(picked)) return null;
    return { path: picked };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.tsv,.txt,.xlsx";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () =>
        resolve({
          name: file.name,
          content:
            typeof reader.result === "string" ? reader.result : new Uint8Array(reader.result as ArrayBuffer),
        });
      reader.onerror = () => resolve(null);
      if (file.name.toLowerCase().endsWith(".xlsx")) reader.readAsArrayBuffer(file);
      else reader.readAsText(file);
    };
    input.click();
  });
}
