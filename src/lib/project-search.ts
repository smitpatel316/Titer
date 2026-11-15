// Project search + sheet highlighting (v2 item 18): Prism's Navigator has a
// search box above it and lets any sheet be highlighted in a color of the
// user's choice, to mark it for review or draw a colleague's attention.
// The search is pure and over the whole project: a sheet's name, a table's
// column names, row titles, cell values and notes, and its floating notes.

import type { NodeType, ProjectNode, SheetHighlight } from "../store/types";
import { SHEET_HIGHLIGHT_STYLE } from "../store/types";

/** Where a hit was found, as the results list names it. */
export type SearchField = "name" | "column" | "row title" | "cell" | "note" | "floating note";
export const SEARCH_FIELD_LABELS: Record<SearchField, string> = {
  name: "name",
  column: "column names",
  "row title": "row titles",
  cell: "cells",
  note: "notes",
  "floating note": "floating notes",
};

/** One sheet that matched, in sidebar order: its first hit as the snippet,
 *  every field that matched, and how many hits it holds in all. */
export interface ProjectSearchMatch {
  nodeId: string;
  nodeType: NodeType;
  nodeName: string;
  parentId: string | null;
  parentName: string | null;
  fields: SearchField[];
  snippet: string;
  count: number;
}

const MAX_SNIPPET = 80;
/** The matched text, trimmed to a readable snippet. */
function snippetOf(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > MAX_SNIPPET ? `${t.slice(0, MAX_SNIPPET - 1)}…` : t;
}

function cellText(value: string | null): string | null {
  if (value === null) return null;
  const t = value.trim();
  return t === "" ? null : t;
}

/**
 * Every sheet whose name, table text or notes contain `query` (case-insensitive
 * substring), in sidebar order — tables with their analyses and graphs, then
 * figures. An empty query matches nothing: the results list stays hidden until
 * the user types. A node appears once, however many hits it holds.
 */
export function searchProject(
  nodes: Record<string, ProjectNode>,
  rootOrder: string[],
  childOrder: Record<string, string[]>,
  query: string,
): ProjectSearchMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ordered: ProjectNode[] = [];
  for (const id of rootOrder) {
    const node = nodes[id];
    if (!node) continue;
    ordered.push(node);
    if (node.type === "table")
      for (const childId of childOrder[id] ?? []) {
        const child = nodes[childId];
        if (child) ordered.push(child);
      }
  }
  const matches: ProjectSearchMatch[] = [];
  for (const node of ordered) {
    const fields: SearchField[] = [];
    const hit = (field: SearchField) => {
      if (!fields.includes(field)) fields.push(field);
    };
    let count = 0;
    let snippet = "";
    const note = (field: SearchField, text: string | null) => {
      if (text === null) return;
      if (!text.toLowerCase().includes(q)) return;
      hit(field);
      count++;
      if (!snippet) snippet = snippetOf(text);
    };
    note("name", node.name);
    if (node.type === "table" && node.data) {
      for (const column of node.data.columns) note("column", column);
      for (const row of node.data.rows) {
        note("row title", cellText(row[0] ?? null));
        for (const cell of row) note("cell", cellText(cell));
      }
      note("note", node.data.notes ?? null);
    }
    for (const floating of node.floatingNotes ?? []) note("floating note", floating.text);
    if (!count) continue;
    matches.push({
      nodeId: node.id,
      nodeType: node.type,
      nodeName: node.name,
      parentId: node.parentId,
      parentName: node.parentId ? (nodes[node.parentId]?.name ?? null) : null,
      fields,
      snippet,
      count,
    });
  }
  return matches;
}

/** A highlighted sheet's Navigator styling: its dot and its row's tint. */
export function highlightStyle(highlight: SheetHighlight | undefined): {
  swatch: string;
  tint: string;
} | null {
  if (!highlight) return null;
  const { swatch, tint } = SHEET_HIGHLIGHT_STYLE[highlight];
  return { swatch, tint };
}
