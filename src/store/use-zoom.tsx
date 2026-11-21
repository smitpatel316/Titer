// Manual zoom (seq 239): one zoom per sheet (graph or figure), shared by
// the view and the View ▸ Zoom menu. A sheet fits its pane until the user
// zooms by hand (Ctrl+scroll, or the menu); Reset returns to the fit.
// View-only: never saved, never undone. 25–400%, the range the graph's
// Ctrl+scroll zoom already used. The store lives outside React so the
// native menu can zoom the active sheet without a render in between.
import * as React from "react";
import { clamp } from "./types";

/** The manual zoom range, as a fraction (25–400%). */
export const ZOOM_LIMITS = { min: 0.25, max: 4 };
/** The stops Zoom In / Zoom Out step through (a fit is not a stop: the
 *  menu's Zoom In from a fit starts at the first stop above the fit). */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** `z` inside the range. Pure, so checks.ts pins it. */
export const clampZoom = (z: number) => clamp(z, ZOOM_LIMITS);
/** The next stop above `z` (or the top). Pure, so checks.ts pins it. */
export const zoomInStep = (z: number) => ZOOM_STEPS.find((s) => s > z + 1e-9) ?? ZOOM_LIMITS.max;
/** The next stop below `z` (or the bottom). Pure, so checks.ts pins it. */
export const zoomOutStep = (z: number) =>
  [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-9) ?? ZOOM_LIMITS.min;

interface ZoomState {
  /** The fit: the sheet scaled to the visible pane (the view's). */
  fit: number;
  /** The user's zoom, or null to follow the fit. */
  explicit: number | null;
}

const zooms = new Map<string, ZoomState>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read(id: string): ZoomState {
  let state = zooms.get(id);
  if (!state) {
    state = { fit: 1, explicit: null };
    zooms.set(id, state);
  }
  return state;
}

/** The zoom a sheet shows: the user's, or its fit. */
export const zoomValue = (id: string) => {
  const state = read(id);
  return state.explicit ?? state.fit;
};

/** The view's fit for a sheet (its ResizeObserver reports it). */
export function setZoomFit(id: string, fit: number) {
  const state = read(id);
  if (state.fit === fit) return;
  zooms.set(id, { ...state, fit });
  emit();
}

/** The user's zoom for a sheet, or null to follow the fit. */
export function setZoomExplicit(id: string, explicit: number | null) {
  const state = read(id);
  const next = explicit === null ? null : clampZoom(explicit);
  if (state.explicit === next) return;
  zooms.set(id, { ...state, explicit: next });
  emit();
}

/** One stop in, from the zoom shown. */
export const zoomInNode = (id: string) => setZoomExplicit(id, zoomInStep(zoomValue(id)));
/** One stop out, from the zoom shown. */
export const zoomOutNode = (id: string) => setZoomExplicit(id, zoomOutStep(zoomValue(id)));
/** The sheet at its true size. */
export const zoomActualSize = (id: string) => setZoomExplicit(id, 1);
/** Back to the fit. */
export const zoomFitNode = (id: string) => setZoomExplicit(id, null);

/** A sheet's zoom, for its view: the zoom shown, the user's zoom (null
 *  while following the fit), the fit, and the setters. */
export function useZoom(id: string) {
  const state = React.useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => read(id),
  );
  return {
    zoom: state.explicit ?? state.fit,
    explicit: state.explicit,
    fit: state.fit,
    setFit: (fit: number) => setZoomFit(id, fit),
    setExplicit: (explicit: number | null) => setZoomExplicit(id, explicit),
  };
}
