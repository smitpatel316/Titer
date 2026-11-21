// The drawing objects selected on a sheet (seq 238), shared by the
// layer and the Arrange menu: the menu acts on the selection, the layer
// shows it. One selection per window (a sheet is shown one at a time);
// switching sheets clears it. View-only: never saved, never undone.
import * as React from "react";

export interface DrawingSelection {
  nodeId: string | null;
  ids: string[];
}

let selection: DrawingSelection = { nodeId: null, ids: [] };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function getDrawingSelection(): DrawingSelection {
  return selection;
}

export function setDrawingSelection(nodeId: string | null, ids: string[]) {
  if (selection.nodeId === nodeId && selection.ids.join("\n") === ids.join("\n")) return;
  selection = { nodeId, ids };
  emit();
}

export function clearDrawingSelection() {
  setDrawingSelection(null, []);
}

/** The selection, for the Arrange menu (which reads it to enable its items). */
export function useDrawingSelection() {
  return React.useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => selection,
  );
}
