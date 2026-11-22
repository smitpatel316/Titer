import * as React from "react";
import {
  ChartLineIcon,
  GridNineIcon,
  InfoIcon,
  LayoutIcon,
  MagnifyingGlassIcon,
  PlusCircleIcon,
  SidebarSimpleIcon,
  SigmaIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button, IconButton } from "../ui/controls";
import { SidePanel, SidebarItem } from "../ui/layout";
import { popupMenu } from "../native";
import { useOutline, useProjectActions, type OutlineNode } from "../store/use-project-store";
import { removeWithConfirm } from "../store/use-document";
import { NODE_NAMES, SHEET_HIGHLIGHTS, SHEET_HIGHLIGHT_STYLE, TAG_COLORS, type TagColor } from "../store/types";
import { colorDot } from "../views/graphs/style-menus";
import { titleCase } from "../lib/format";
import { highlightStyle, searchProject, SEARCH_FIELD_LABELS } from "../lib/project-search";
import { clampWidth, SIDEBAR_WIDTH, useLayout } from "../store/use-layout";

/** What's currently being dragged. Tables reorder among tables; children reorder
 *  only among siblings of the same table (never across tables, never into a table). */
type DragInfo = { kind: "table" | "child"; id: string; parentId: string | null };
type DropTarget = { id: string; position: "before" | "after" };
type RowDnd = { id: string; onPointerDown: (e: React.PointerEvent) => void };

/** Move `sourceId` to just before/after `targetId` within an ordered id list. */
function move(order: string[], sourceId: string, targetId: string, position: "before" | "after"): string[] {
  const without = order.filter((id) => id !== sourceId);
  const targetIdx = without.indexOf(targetId);
  if (targetIdx === -1) return order;
  const insertAt = position === "before" ? targetIdx : targetIdx + 1;
  return [...without.slice(0, insertAt), sourceId, ...without.slice(insertAt)];
}

const dropClass = (target: DropTarget | null, id: string): string => {
  if (target?.id !== id) return "";
  // Inset shadow draws a Finder-style insertion line without shifting layout.
  return target.position === "before"
    ? "shadow-[inset_0_2px_0_0_var(--color-accent)]"
    : "shadow-[inset_0_-2px_0_0_var(--color-accent)]";
};

// Reordering uses plain pointer events + elementFromPoint hit-testing on the rows'
// DOM `id`s (no HTML5 drag and drop: the native shell handles file drops itself).
const rowDomId = (kind: DragInfo["kind"], id: string, parentId: string | null) =>
  `sidebar-row:${kind}:${parentId ?? ""}:${id}`;

function parseRowDomId(domId: string): DragInfo | null {
  const m = domId.match(/^sidebar-row:(table|child):([^:]*):(.+)$/);
  return m ? { kind: m[1] as DragInfo["kind"], parentId: m[2] || null, id: m[3] } : null;
}

/** Shows or hides the sidebar (View ▸ Hide Sidebar, ⌘B). It sits at the sidebar's right
 *  edge, facing the inspector button; with the sidebar hidden, the shell shows it
 *  beside the traffic lights. */
export function SidebarToggle({ className }: { className?: string }) {
  const { sidebar, setLayout } = useLayout();
  return (
    <IconButton
      aria-label={sidebar ? "Hide Sidebar" : "Show Sidebar"}
      className={className}
      onClick={() => setLayout({ sidebar: !sidebar })}
    >
      <SidebarSimpleIcon />
    </IconButton>
  );
}

export function ProjectSidebar() {
  // The outline, not the whole project: editing a table or a graph doesn't redraw the sidebar.
  const { tables, infos, figures, orphaned, activeNodeId } = useOutline();
  const { get, setActiveNode, renameNode, removeNode, duplicateFamily, openSelector, reorderTables, reorderChildren, createFigure, setSheetHighlight, createInfoSheet, setTags } =
    useProjectActions();
  const { sidebar, sidebarWidth, setLayout } = useLayout();

  // Project search (v2 item 18): Prism's Navigator has a search box above it,
  // searching every sheet's text. The results come from the project as it is
  // now (the outline only redraws on names, order and selection, so the
  // search reads the store directly); a click jumps to the sheet.
  const [query, setQuery] = React.useState("");
  const results = React.useMemo(() => {
    if (!query.trim()) return [];
    const s = get();
    return searchProject(s.nodes, s.rootOrder, s.childOrder, query);
    // The outline (tables, figures) changes on every rename, reorder and
    // selection — enough to refresh the results while the user types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tables, figures]);

  const dragInfo = React.useRef<DragInfo | null>(null);
  const dropTargetRef = React.useRef<DropTarget | null>(null);
  const [dropTarget, setDropTarget] = React.useState<DropTarget | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  // Removes the drag's window listeners; set only while dragging.
  const cleanupRef = React.useRef<(() => void) | null>(null);

  // A drag cut short by unmounting (its row deleted) is torn down too.
  React.useEffect(() => () => cleanupRef.current?.(), []);

  const allowed = (src: DragInfo, kind: DragInfo["kind"], parentId: string | null) =>
    kind === "table" ? src.kind === "table" : src.kind === "child" && src.parentId === parentId;

  const setTarget = (next: DropTarget | null) => {
    dropTargetRef.current = next;
    setDropTarget((prev) => (prev?.id === next?.id && prev?.position === next?.position ? prev : next));
  };

  function endDrag() {
    cleanupRef.current?.();
    dragInfo.current = null;
    setTarget(null);
    setDraggingId(null);
    document.body.style.cursor = "";
  }

  const onPointerMove = (e: PointerEvent) => {
    const src = dragInfo.current;
    if (!src) return;
    const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
      "[id^='sidebar-row:']",
    );
    const target = row ? parseRowDomId(row.id) : null;
    if (!row || !target || target.id === src.id || !allowed(src, target.kind, target.parentId)) {
      setTarget(null);
      return;
    }
    const rect = row.getBoundingClientRect();
    const position: DropTarget["position"] = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setTarget({ id: target.id, position });
  };

  const onPointerUp = () => {
    const src = dragInfo.current;
    const target = dropTargetRef.current;
    if (src && target) {
      // The drag's window listeners outlive renders: they read the project as it is now.
      const { rootOrder, childOrder } = get();
      if (src.kind === "table") reorderTables(move(rootOrder, src.id, target.id, target.position));
      else if (src.parentId)
        reorderChildren(src.parentId, move(childOrder[src.parentId] ?? [], src.id, target.id, target.position));
    }
    endDrag();
  };

  const rowDnd = (kind: DragInfo["kind"], id: string, parentId: string | null): RowDnd => ({
    id: rowDomId(kind, id, parentId),
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      dragInfo.current = { kind, id, parentId };
      setDraggingId(id);
      document.body.style.cursor = "grabbing";
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", endDrag);
      cleanupRef.current = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", endDrag);
        cleanupRef.current = null;
      };
    },
  });

  // A frozen sheet (seq 237) shows in italics, as in Prism's Navigator.
  const frozenClass = (node: OutlineNode) => (node.frozen ? "italic" : "");
  const rowClass = (id: string): string =>
    [dropClass(dropTarget, id), draggingId === id ? "opacity-40" : ""].filter(Boolean).join(" ");

  // The table, analysis or graph whose name is edited in place; the sidebar keeps the
  // keyboard after.
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const rename = (node: OutlineNode, name: string) => {
    if (name.trim() && name.trim() !== node.name) renameNode(node.id, name.trim());
    setRenaming(null);
    listRef.current?.focus();
  };

  // Tables whose analyses and graphs are hidden; with ⌥, a triangle folds or unfolds them all.
  const { foldedTables: collapsed, setFoldedTables: setCollapsed } = useLayout();
  const setOpen = (id: string, open: boolean, all = false) => {
    const next = new Set(collapsed);
    for (const t of all ? tables.map((t) => t.id) : [id]) {
      if (open) next.delete(t);
      else next.add(t);
    }
    setCollapsed(next);
  };
  // An analysis or graph that comes to show (a new one, one brought back by Undo) is
  // never hidden in its folded table.
  React.useEffect(() => {
    const table = tables.find((t) => t.children.some((c) => c.id === activeNodeId));
    if (table && collapsed.has(table.id)) setOpen(table.id, true);
  }, [activeNodeId]);

  // The keyboard, as in the Finder: ↑↓ move, ←→ fold and unfold (← from an analysis
  // or graph goes to its table), Return renames. ⌘⌫ deletes, from the Table menu.
  // The sidebar keeps the keyboard once used, as in the Finder: a table's grid, which
  // takes it when it shows, gets it back from a click in the table.
  const listRef = React.useRef<HTMLDivElement>(null);
  const select = (id: string) => {
    setActiveNode(id);
    setTimeout(() => listRef.current?.focus()); // after the view shows
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const node = [...tables.flatMap((t) => [t, ...t.children]), ...infos, ...figures, ...orphaned].find(
      (n) => n.id === activeNodeId,
    );
    if (!node || e.metaKey || e.altKey || e.ctrlKey) return;
    const rows = [
      ...tables.flatMap((t) => [t.id, ...(collapsed.has(t.id) ? [] : t.children.map((c) => c.id))]),
      ...infos.map((f) => f.id),
      ...figures.map((f) => f.id),
      ...orphaned.map((o) => o.id),
    ];
    const i = rows.indexOf(node.id);
    if (e.key === "ArrowDown") select(rows[Math.min(rows.length - 1, i + 1)]);
    else if (e.key === "ArrowUp") select(rows[Math.max(0, i - 1)]);
    else if (e.key === "ArrowLeft") node.parentId ? select(node.parentId) : setOpen(node.id, false);
    else if (e.key === "ArrowRight") setOpen(node.id, true);
    else if (e.key === "Enter") setRenaming(node.id);
    else return;
    e.preventDefault();
  };

  // The Finder's tags: each color ringed while the item has it; a pick adds or takes it away.
  const tagsMenu = (node: OutlineNode) => ({
    text: "Tags",
    items: (Object.keys(TAG_COLORS) as TagColor[]).map((color) => {
      const on = node.tags?.includes(color) ?? false;
      return {
        text: titleCase(color),
        icon: colorDot(TAG_COLORS[color], on),
        action: () =>
          setTags(
            node.id,
            (Object.keys(TAG_COLORS) as TagColor[]).filter((c) => (c === color ? !on : node.tags?.includes(c))),
          ),
      };
    }),
  });

  const tableMenu = (table: OutlineNode & { children: OutlineNode[] }) =>
    void popupMenu([
      { text: "New Analysis…", action: () => openSelector({ kind: "new-analysis", tableId: table.id }) },
      { text: "Simulate data…", action: () => openSelector({ kind: "simulate-data", tableId: table.id }) },
      { text: "Use Wand…", action: () => openSelector({ kind: "wand", tableId: table.id }) },
      { text: "New Graph…", action: () => openSelector({ kind: "new-graph", tableId: table.id }) },
      { text: "New Figure…", action: () => createFigure() },
      { item: "Separator" },
      { text: "Duplicate Family", action: () => duplicateFamily(table.id) },
      { text: "Rename", action: () => setRenaming(table.id) },
      tagsMenu(table),
      highlightMenu(table),
      // The last table stays: a project is never empty.
      {
        text: `Delete ${NODE_NAMES.table}…`,
        enabled: tables.length > 1,
        action: () =>
          removeWithConfirm(
            table,
            removeNode,
            table.children.some((c) => c.type === "analysis")
              ? "Its analyses will be kept as orphaned results and its graphs will be deleted. You can undo this."
              : undefined,
          ),
      },
    ]);

  // A sheet's highlight color (v2 item 18): Prism marks a sheet for review or
  // a colleague's attention with a color of the user's choice, from the
  // Navigator's right-click menu. The current color gets a check mark.
  const highlightMenu = (node: OutlineNode) => ({
    text: "Highlight Sheet",
    items: [
      ...SHEET_HIGHLIGHTS.map((color) => ({
        text: `${node.highlight === color ? "✓ " : ""}${SHEET_HIGHLIGHT_STYLE[color].label}`,
        action: () => setSheetHighlight(node.id, color),
      })),
      { item: "Separator" },
      { text: "None", action: () => setSheetHighlight(node.id, null) },
    ],
  });

  const childMenu = (child: OutlineNode) =>
    void popupMenu([
      ...(child.type === "graph"
        ? [
            { text: "New Figure from this Graph…", action: () => createFigure([child.id]) },
            { text: "Clone Graph…", action: () => openSelector({ kind: "clone-graph", graphId: child.id }) },
          ]
        : []),
      { text: "Rename", action: () => setRenaming(child.id) },
      tagsMenu(child),
      highlightMenu(child),
      { text: `Delete ${NODE_NAMES[child.type]}…`, action: () => removeWithConfirm(child, removeNode) },
    ]);

  return (
    <SidePanel
      side="left"
      pane="navigator"
      open={sidebar}
      width={sidebarWidth}
      minWidth={SIDEBAR_WIDTH.min}
      onResize={(width, open) => setLayout({ sidebar: open, sidebarWidth: clampWidth(width, SIDEBAR_WIDTH) })}
      header={<SidebarToggle />}
      footer={
        <div className="flex flex-col">
          <Button variant="ghost" className="text-secondary" onClick={() => openSelector({ kind: "new-table" })}>
            <PlusCircleIcon className="size-4" />
            New Table…
          </Button>
          <Button variant="ghost" className="text-secondary" onClick={() => createInfoSheet()}>
            <PlusCircleIcon className="size-4" />
            New Info Sheet…
          </Button>
        </div>
      }
    >
      <div className="px-2 pt-1">
        <div className="flex h-7 items-center gap-1.5 rounded-md bg-control px-2">
          <MagnifyingGlassIcon className="size-4 shrink-0 text-secondary" />
          <input
            aria-label="Search project"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search project"
            className="min-w-0 flex-1 bg-transparent text-regular outline-none placeholder:text-secondary"
          />
          {query !== "" && (
            <IconButton aria-label="Clear search" onClick={() => setQuery("")}>
              <XIcon className="size-4" />
            </IconButton>
          )}
        </div>
        {query.trim() !== "" && (
          <div role="listbox" aria-label="Project search results" className="mt-1 max-h-56 overflow-y-auto">
            {results.length === 0 ? (
              <p className="px-2 py-1 text-regular text-secondary">No sheets match “{query.trim()}”.</p>
            ) : (
              results.map((r) => (
                <button
                  key={r.nodeId}
                  type="button"
                  role="option"
                  aria-label={`Search result: ${r.nodeName}`}
                  onClick={() => {
                    if (r.parentId) setOpen(r.parentId, true);
                    select(r.nodeId);
                  }}
                  className="flex w-full flex-col items-start rounded-md px-2 py-1 text-left hover:bg-control"
                >
                  <span className="w-full truncate text-regular">{r.nodeName}</span>
                  <span className="w-full truncate text-small text-secondary">
                    {r.parentName ? `${r.parentName} · ` : ""}
                    {r.count} {r.count === 1 ? "match" : "matches"} ·{" "}
                    {r.fields.map((f) => SEARCH_FIELD_LABELS[f]).join(", ")}
                  </span>
                  <span className="w-full truncate text-small text-secondary">“{r.snippet}”</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <div
        ref={listRef}
        role="tree"
        aria-label="Project"
        tabIndex={0}
        className="group px-2 pb-2 outline-none"
        onKeyDown={onKeyDown}
      >
        {tables.map((table) => (
          <SidebarItem
            key={table.id}
            icon={<GridNineIcon className="size-4" />}
            tags={table.tags?.map((c) => TAG_COLORS[c])}
            title={table.name}
            selected={activeNodeId === table.id}
            highlight={highlightStyle(table.highlight) ?? undefined}
            renaming={renaming === table.id}
            onRename={(name) => rename(table, name)}
            open={!collapsed.has(table.id)}
            onToggle={(all) => setOpen(table.id, collapsed.has(table.id), all)}
            onClick={() => select(table.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              tableMenu(table);
            }}
            className={rowClass(table.id)}
            {...rowDnd("table", table.id, null)}
          >
            {table.children.map((child) => (
              <SidebarItem
                key={child.id}
                icon={
                  child.type === "analysis" ? <SigmaIcon className="size-4" /> : <ChartLineIcon className="size-4" />
                }
                tags={child.tags?.map((c) => TAG_COLORS[c])}
                title={child.name}
                selected={activeNodeId === child.id}
                highlight={highlightStyle(child.highlight) ?? undefined}
                renaming={renaming === child.id}
                onRename={(name) => rename(child, name)}
                onClick={() => select(child.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  childMenu(child);
                }}
                className={[rowClass(child.id), frozenClass(child)].filter(Boolean).join(" ")}
                {...rowDnd("child", child.id, table.id)}
              />
            ))}
          </SidebarItem>
        ))}
        {infos.map((info) => (
          <SidebarItem
            key={info.id}
            icon={<InfoIcon className="size-4" />}
            tags={info.tags?.map((c) => TAG_COLORS[c])}
            title={info.name}
            selected={activeNodeId === info.id}
            renaming={renaming === info.id}
            onRename={(name) => rename(info, name)}
            onClick={() => select(info.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              childMenu(info);
            }}
          />
        ))}
        {figures.map((figure) => (
          <SidebarItem
            key={figure.id}
            icon={<LayoutIcon className="size-4" />}
            tags={figure.tags?.map((c) => TAG_COLORS[c])}
            title={figure.name}
            selected={activeNodeId === figure.id}
            highlight={highlightStyle(figure.highlight) ?? undefined}
            renaming={renaming === figure.id}
            onRename={(name) => rename(figure, name)}
            onClick={() => select(figure.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              childMenu(figure);
            }}
            className={frozenClass(figure)}
          />
        ))}
        {orphaned.map((orphan) => (
          <SidebarItem
            key={orphan.id}
            icon={<SigmaIcon className="size-4" />}
            tags={orphan.tags?.map((c) => TAG_COLORS[c])}
            title={orphan.name}
            suffix="(orphaned)"
            selected={activeNodeId === orphan.id}
            renaming={renaming === orphan.id}
            onRename={(name) => rename(orphan, name)}
            onClick={() => select(orphan.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              childMenu(orphan);
            }}
          />
        ))}
      </div>
    </SidePanel>
  );
}
