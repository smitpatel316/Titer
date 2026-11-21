// Gallery view (seq 229): Prism's Gallery shows every graph in the project
// on one sheet, so the user can see them all and jump to one. The list is
// pure — the view only renders it — in sidebar order (each table's graphs,
// in the order they sit under it), with the chart type's label and the
// table the graph belongs to.
import { GRAPHS } from "../views/graphs";
import type { ProjectNode } from "../store/types";

export interface GalleryItem {
  id: string;
  name: string;
  /** The chart type's label ("Column", "XY scatter", …). */
  graphLabel: string;
  /** The table the graph belongs to. */
  tableName: string;
}

/** Every graph in the project, in sidebar order. Figures are layouts, not
 *  graphs, so they don't appear here — they have their own sheets. */
export function galleryItems(
  nodes: Record<string, ProjectNode>,
  rootOrder: string[],
  childOrder: Record<string, string[]>,
): GalleryItem[] {
  const items: GalleryItem[] = [];
  for (const tableId of rootOrder) {
    const table = nodes[tableId];
    if (!table || table.type !== "table") continue;
    for (const childId of childOrder[tableId] ?? []) {
      const child = nodes[childId];
      if (!child || child.type !== "graph" || !child.graphType) continue;
      items.push({
        id: child.id,
        name: child.name,
        graphLabel: GRAPHS[child.graphType]?.label ?? child.graphType,
        tableName: table.name,
      });
    }
  }
  return items;
}
