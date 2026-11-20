// Text/drawing/picture objects on a graph or figure sheet (seq 238):
// Prism's Insert Text / Picture / Drawing, as a DOM layer over the sheet
// (like floating notes). Positions are px from the sheet's top-left, in
// the sheet's own px — inside a zoomed sheet the layer inherits the
// sheet's scale, so objects stay pinned to the graph. Screen-only, like
// floating notes: the exporters render the Plotly figure, never this DOM
// layer, so objects never reach an exported image (export inclusion is a
// follow-up). The layer itself is `pointer-events-none` except for the
// objects, so the sheet beneath keeps working; an object drags from its
// body, resizes from its corner, edits text on double-click, and deletes
// with the Delete key. Clicking one member of a group selects the group.
import * as React from "react";
import { MAX_PICTURE_BYTES, type DrawingObject, type DrawingObjectKind } from "../store/types";
import { useProjectActions } from "../store/use-project-store";
import {
  clearDrawingSelection,
  getDrawingSelection,
  setDrawingSelection,
} from "../store/drawing-selection";
import * as native from "../native";
import { cn } from "../ui/controls";

/** A new drawing object's id, like the store's `genId`. */
export function newDrawingId() {
  return `drawing_${Math.random().toString(36).slice(2, 10)}`;
}

/** A fresh object of `kind`, staggered so it never lands exactly on the
 *  last one. Built from the objects already on the sheet. */
export function newDrawingObject(kind: DrawingObjectKind, objects: DrawingObject[]): DrawingObject {
  const step = objects.length % 5;
  const at = { x: 24 + step * 24, y: 24 + step * 24 };
  switch (kind) {
    case "text":
      return { id: newDrawingId(), kind, ...at, width: 160, height: 40, text: "Text", fontSize: 14, color: "#000000" };
    case "rect":
    case "ellipse":
      return { id: newDrawingId(), kind, ...at, width: 120, height: 80, color: "#000000", fill: "none", strokeWidth: 1.5 };
    case "line":
    case "arrow":
      return { id: newDrawingId(), kind, ...at, width: 120, height: 40, color: "#000000", strokeWidth: 1.5 };
    case "picture":
      return { id: newDrawingId(), kind, ...at, width: 200, height: 150 };
  }
}

/** The file picker for Insert Picture: reads the image as a data URL (the
 *  `.hlx` file stays self-contained) and refuses pictures over the cap. */
export function insertPictureObject(
  nodeId: string,
  objects: DrawingObject[],
  add: (nodeId: string, object: DrawingObject) => void,
) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      // A data URL is ~4/3 the bytes it holds.
      if (src.length * 0.75 > MAX_PICTURE_BYTES) {
        void native.alert(
          "Picture Too Large",
          `“${file.name}” is over ${Math.round(MAX_PICTURE_BYTES / 1_000_000)} MB — pick a smaller picture.`,
          "error",
        );
        return;
      }
      add(nodeId, { ...newDrawingObject("picture", objects), src });
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

/** The objects on a sheet, over its content. The parent must be `relative`:
 *  the layer covers it, and object positions are px from its top-left.
 *  `zoom` is the sheet's scale: a drag's screen px divided by it are sheet px. */
export function DrawingObjectsLayer({ node, zoom }: { node: ProjectNode; zoom: number }) {
  const { updateDrawingObject, deleteDrawingObject } = useProjectActions();
  const objects = node.drawingObjects ?? [];
  const [selection, setSelection] = React.useState<ReadonlySet<string>>(new Set());
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");
  // A drag in flight, in screen px: the object's (or group's) offset from
  // its saved position, or a resize's delta — committed on pointer-up, so
  // one drag is one undo step and the sheet doesn't redraw mid-drag.
  const [drag, setDrag] = React.useState<{ ids: string[]; dx: number; dy: number; dw: number; dh: number } | null>(
    null,
  );

  // The selection the Arrange menu acts on: this sheet's, cleared when
  // another sheet takes over (its layer mounts) or unmounts.
  React.useEffect(() => {
    if (getDrawingSelection().nodeId !== node.id) setDrawingSelection(node.id, []);
    return () => {
      if (getDrawingSelection().nodeId === node.id) clearDrawingSelection();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const select = (ids: string[]) => {
    setSelection(new Set(ids));
    setDrawingSelection(node.id, ids);
  };
  const selectObject = (object: DrawingObject, additive: boolean) => {
    // A grouped object selects its whole group.
    const group = object.groupId
      ? objects.filter((o) => o.groupId === object.groupId).map((o) => o.id)
      : [object.id];
    if (!additive) return select(group);
    const next = new Set(selection);
    const adding = group.some((id) => !next.has(id));
    for (const id of group) {
      if (adding) next.add(id);
      else next.delete(id);
    }
    select([...next]);
  };

  const startDrag = (e: React.PointerEvent, object: DrawingObject, resize: boolean) => {
    e.stopPropagation();
    e.preventDefault();
    const ids = selection.has(object.id)
      ? [...selection]
      : (() => {
          selectObject(object, false);
          return object.groupId
            ? objects.filter((o) => o.groupId === object.groupId).map((o) => o.id)
            : [object.id];
        })();
    const startX = e.clientX;
    const startY = e.clientY;
    const moved = { ids, dx: 0, dy: 0, dw: 0, dh: 0 };
    const onMove = (ev: PointerEvent) => {
      if (resize) {
        moved.dw = ev.clientX - startX;
        moved.dh = ev.clientY - startY;
      } else {
        moved.dx = ev.clientX - startX;
        moved.dy = ev.clientY - startY;
      }
      setDrag({ ...moved });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      for (const id of moved.ids) {
        const o = objects.find((x) => x.id === id);
        if (!o) continue;
        if (resize) {
          updateDrawingObject(node.id, id, {
            width: Math.max(8, Math.round(o.width + moved.dw / zoom)),
            height: Math.max(8, Math.round(o.height + moved.dh / zoom)),
          });
        } else if (moved.dx !== 0 || moved.dy !== 0) {
          updateDrawingObject(node.id, id, {
            x: Math.max(0, Math.round(o.x + moved.dx / zoom)),
            y: Math.max(0, Math.round(o.y + moved.dy / zoom)),
          });
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const commitText = (object: DrawingObject) => {
    setEditingId(null);
    if (editText !== (object.text ?? "")) updateDrawingObject(node.id, object.id, { text: editText });
  };

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      onClick={() => select([])}
      onKeyDown={(e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && selection.size && editingId === null) {
          e.preventDefault();
          for (const id of selection) deleteDrawingObject(node.id, id);
          select([]);
        }
      }}
    >
      {objects.map((object) => {
        const off = drag && drag.ids.includes(object.id) ? drag : null;
        const x = object.x + (off ? off.dx / zoom : 0);
        const y = object.y + (off ? off.dy / zoom : 0);
        const width = Math.max(8, object.width + (off ? off.dw / zoom : 0));
        const height = Math.max(8, object.height + (off ? off.dh / zoom : 0));
        const selected = selection.has(object.id);
        const editing = editingId === object.id;
        return (
          <div
            key={object.id}
            role="button"
            aria-label={`${object.kind} object${selected ? ", selected" : ""}`}
            tabIndex={0}
            className={cn("pointer-events-auto absolute", selected && "z-10 outline-2 outline-accent")}
            style={{ left: x, top: y, width, height }}
            onClick={(e) => {
              e.stopPropagation();
              selectObject(object, e.metaKey || e.shiftKey);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (object.kind === "text") {
                setEditingId(object.id);
                setEditText(object.text ?? "");
              }
            }}
            onPointerDown={(e) => {
              if (editing || e.button !== 0) return;
              startDrag(e, object, false);
            }}
          >
            {object.kind === "text" ? (
              editing ? (
                <textarea
                  autoFocus
                  value={editText}
                  aria-label="Object text"
                  className="h-full w-full resize-none overflow-hidden bg-white/90 p-1 outline-none"
                  style={{ fontSize: object.fontSize ?? 14, color: object.color ?? "#000000" }}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => commitText(object)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setEditingId(null);
                      setEditText(object.text ?? "");
                    }
                    e.stopPropagation();
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              ) : (
                <div
                  className="h-full w-full overflow-hidden whitespace-pre-wrap break-words"
                  style={{ fontSize: object.fontSize ?? 14, color: object.color ?? "#000000" }}
                >
                  {object.text ?? ""}
                </div>
              )
            ) : object.kind === "picture" ? (
              <img src={object.src} alt="" draggable={false} className="h-full w-full object-fill" />
            ) : object.kind === "line" || object.kind === "arrow" ? (
              <svg width={width} height={height} className="h-full w-full">
                <defs>
                  <marker id={`arrow-${object.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill={object.color ?? "#000000"} />
                  </marker>
                </defs>
                <line
                  x1={2}
                  y1={height - 2}
                  x2={width - 2}
                  y2={2}
                  stroke={object.color ?? "#000000"}
                  strokeWidth={object.strokeWidth ?? 1.5}
                  markerEnd={object.kind === "arrow" ? `url(#arrow-${object.id})` : undefined}
                />
              </svg>
            ) : (
              <div
                className="h-full w-full"
                style={{
                  border: `${object.strokeWidth ?? 1.5}px solid ${object.color ?? "#000000"}`,
                  background: object.fill && object.fill !== "none" ? object.fill : "transparent",
                  borderRadius: object.kind === "ellipse" ? "50%" : 0,
                }}
              />
            )}
            {selected && selection.size === 1 && (
              <span
                role="slider"
                aria-label="Resize object"
                title="Drag to resize"
                className="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-full border border-white bg-accent"
                onPointerDown={(e) => startDrag(e, object, true)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
