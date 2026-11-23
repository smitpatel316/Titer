// Drag-and-drop onto a figure (seq 307): the drag session shared by the
// Navigator/sidebar (a graph dragged in) and the figure view (a panel
// dragged onto another cell). The sidebar's reorder drag is pointer-based,
// not HTML5 drag-and-drop — the native shell handles file drops itself —
// so figure drops ride the same pointer events: the drag source and the
// hovered drop target live here, outside React, and the figure view reads
// them to highlight its target while the drop handler it registered applies
// the drop on pointer-up. Touch and drags from outside the app are out of scope.
import * as React from "react";
import type { FigureDropSource, FigureDropTarget } from "./figure";

/** A figure cell as a drop target, with the figure it belongs to. */
export interface FigureDropTargetRef extends FigureDropTarget {
  figureId: string;
}

/** The drag in progress, if any, and the cell it hovers over. */
export interface FigureDragState {
  source: FigureDropSource | null;
  target: FigureDropTargetRef | null;
}

let state: FigureDragState = { source: null, target: null };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeFigureDrag(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFigureDrag(): FigureDragState {
  return state;
}

/** The figure view reads the drag through this hook, to highlight its target. */
export function useFigureDrag(): FigureDragState {
  return React.useSyncExternalStore(subscribeFigureDrag, getFigureDrag);
}

export function beginFigureDrag(source: FigureDropSource): void {
  state = { source, target: null };
  emit();
}

export function setFigureDragTarget(target: FigureDropTargetRef | null): void {
  if (
    state.target?.figureId === target?.figureId &&
    state.target?.row === target?.row &&
    state.target?.col === target?.col
  )
    return;
  state = { ...state, target };
  emit();
}

export function endFigureDrag(): void {
  if (!state.source && !state.target) return;
  state = { source: null, target: null };
  emit();
}

/** The figure view's drop handler: the sidebar and the figure view both call
 *  it on pointer-up, and it applies the drop (asking first when the drop
 *  would replace something). One figure view is mounted at a time, so one
 *  handler is enough; it ignores targets for another figure. */
export type FigureDropHandler = (
  source: FigureDropSource,
  target: FigureDropTargetRef,
) => boolean | Promise<boolean>;

let dropHandler: FigureDropHandler | null = null;

export function registerFigureDropHandler(handler: FigureDropHandler | null): void {
  dropHandler = handler;
}

export function getFigureDropHandler(): FigureDropHandler | null {
  return dropHandler;
}

/** The drop target under a point, if any: a figure panel or an empty cell,
 *  marked with `data-figure-drop` and its figure id and cell.
 *  Hit-tested by bounding rect, not the browser's point hit-test (seq 394):
 *  pressing a Plotly chart makes WebKit's point hit-test return null for
 *  the rest of the drag — the chart's mousedown handler owns the gesture —
 *  so a panel drag started on a chart never found its target, while a drag
 *  started on plain HTML hit-tested fine. Rects are immune to that quirk.
 *  Smallest containing rect wins, so a nested drop target beats its parent. */
export function figureDropTargetFromPoint(x: number, y: number): FigureDropTargetRef | null {
  let best: HTMLElement | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const el of document.querySelectorAll("[data-figure-drop]")) {
    const r = (el as HTMLElement).getBoundingClientRect();
    if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) continue;
    const area = r.width * r.height;
    if (area < bestArea) {
      best = el as HTMLElement;
      bestArea = area;
    }
  }
  if (!best) return null;
  const figureId = best.dataset.figureId;
  const row = Number(best.dataset.dropRow);
  const col = Number(best.dataset.dropCol);
  if (!figureId || !Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { figureId, row, col };
}
