// Gallery view (seq 229): one sheet showing every graph in the project, as
// Prism's Gallery does. A card names the graph, its chart type and its table;
// opening one shows that graph. The view is per-window, like the sidebar.
import * as React from "react";
import { EmptyState } from "../ui/layout";
import { useProjectStore } from "../store/use-project-store";
import { useLayout } from "../store/use-layout";
import { galleryItems } from "../lib/gallery";

export function GalleryView() {
  const { nodes, rootOrder, childOrder, setActiveNode } = useProjectStore();
  const { setLayout } = useLayout();
  const items = React.useMemo(() => galleryItems(nodes, rootOrder, childOrder), [nodes, rootOrder, childOrder]);
  const open = (id: string) => {
    setActiveNode(id);
    setLayout({ gallery: false });
  };

  if (items.length === 0)
    return (
      <EmptyState
        title="No Graphs Yet"
        description="Create a graph from a table — Graph ▸ New Graph… — and it will appear here."
      />
    );

  return (
    <div className="h-full overflow-auto p-6">
      <h1 className="mb-1 text-large-strong">Gallery</h1>
      <p className="mb-4 text-regular text-secondary">
        {items.length === 1 ? "1 graph" : `${items.length} graphs`} in this project. Select one to open it.
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => open(item.id)}
            onDoubleClick={() => open(item.id)}
            className="rounded-lg bg-surface p-3 text-left ring-1 ring-separator hover:ring-accent"
          >
            <div className="truncate text-regular font-medium">{item.name}</div>
            <div className="truncate text-small text-secondary">{item.graphLabel}</div>
            <div className="truncate text-small text-secondary">from {item.tableName}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
