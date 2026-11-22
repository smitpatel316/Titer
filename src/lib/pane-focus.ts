// F6 / Shift+F6 pane cycling (seq 300): Prism cycles keyboard focus
// Navigator → sheet → floating notes → Inspector, and Titer had no F6
// handling at all. The panes are marked with `data-pane` in the shell
// (app-shell, project-sidebar, floating-notes, inspector); this module
// is the whole cycle — pure order logic plus the small DOM surface it
// needs, so the pin test can run it against a fake document.
export type PaneId = "navigator" | "sheet" | "notes" | "inspector";

/** The cycle order: Navigator → sheet → floating notes → Inspector → back. */
export const PANE_ORDER: readonly PaneId[] = ["navigator", "sheet", "notes", "inspector"];

/** The class marking the pane that holds the keyboard focus: the visible
 *  ring (styles.css). It follows DOM focus (see `syncPaneRingFromFocus`),
 *  so Tab inside a pane keeps its ring. */
export const PANE_RING_CLASS = "f6-pane-active";

const PANE_ATTR = "data-pane";

// A control, or a tabbable element: the sidebar's tree (tabIndex 0) is a
// stop, but nothing tabbed out of order (tabIndex -1) is — those are
// disclosure buttons and the like, reached by Tab from their row.
const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** Whether an element can take DOM focus right now: closed panels are
 *  `inert` (their controls stay in the DOM but take no focus), and a
 *  zero-size element (display:none, or a folded panel's content) doesn't
 *  either. */
function isFocusable(el: Element): boolean {
  if ((el as { disabled?: boolean }).disabled) return false;
  if (el.closest("[inert]")) return false;
  if (el.getClientRects().length === 0) return false;
  return true;
}

/** A pane's first focusable control, in document order — the one F6 lands
 *  on, so the keyboard works there immediately. Null when the pane has
 *  nothing focusable (no floating notes, a closed panel). */
export function firstFocusable(root: Element): HTMLElement | null {
  const all = root.querySelectorAll(FOCUSABLE_SELECTOR);
  for (const el of all) {
    if (isFocusable(el)) return el as HTMLElement;
  }
  return null;
}

function paneRoot(doc: Document, id: PaneId): Element | null {
  return doc.querySelector(`[${PANE_ATTR}="${id}"]`);
}

/** The panes that are stops right now, in cycle order: a pane counts only
 *  when it is in the DOM and has a focusable control. */
export function availablePanes(doc: Document): PaneId[] {
  return PANE_ORDER.filter((id) => {
    const root = paneRoot(doc, id);
    return root !== null && firstFocusable(root) !== null;
  });
}

/** The pane the keyboard is in now, from where DOM focus sits — null when
 *  focus is outside every pane (body, a dialog). */
export function currentPane(doc: Document): PaneId | null {
  const id = doc.activeElement?.closest?.(`[${PANE_ATTR}]`)?.getAttribute(PANE_ATTR);
  return id !== null && id !== undefined && (PANE_ORDER as readonly string[]).includes(id) ? (id as PaneId) : null;
}

/** The next stop: one step forward (F6) or back (Shift+F6), wrapping, and
 *  skipping stops that aren't available. From outside any pane, forward
 *  starts at the Navigator, backward at the Inspector. Null when no pane
 *  is a stop at all. */
export function nextPaneId(current: PaneId | null, direction: 1 | -1, available: readonly PaneId[]): PaneId | null {
  if (available.length === 0) return null;
  const at = current === null ? -1 : available.indexOf(current);
  if (at === -1) return direction === 1 ? available[0] : available[available.length - 1];
  return available[(at + direction + available.length) % available.length];
}

/** Move the ring to one pane (or clear it when `id` is null). */
export function setPaneRing(doc: Document, id: PaneId | null): void {
  for (const root of doc.querySelectorAll(`[${PANE_ATTR}]`)) {
    root.classList.toggle(PANE_RING_CLASS, root.getAttribute(PANE_ATTR) === id);
  }
}

/** Focus a pane: its first focusable control gets DOM focus, and the ring
 *  moves to it. False when the pane has nothing focusable. */
export function focusPane(doc: Document, id: PaneId): boolean {
  const root = paneRoot(doc, id);
  const target = root && firstFocusable(root);
  if (!target) return false;
  target.focus();
  setPaneRing(doc, id);
  return true;
}

/** One F6 (forward) or Shift+F6 (backward) step from wherever focus is.
 *  Returns the pane landed on, or null when there is nowhere to go. */
export function cyclePaneFocus(doc: Document, direction: 1 | -1): PaneId | null {
  const next = nextPaneId(currentPane(doc), direction, availablePanes(doc));
  if (next === null) return null;
  return focusPane(doc, next) ? next : null;
}

export type PaneCycleKeyEvent = {
  key: string;
  shiftKey: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target?: unknown;
};

/** The key filter for the global handler: a bare F6 / Shift+F6 cycles, and
 *  only that. Modifiers (Cmd/Ctrl/Alt+F6 belong to something else), other
 *  keys, and a modal dialog — which owns the keyboard while it is open —
 *  all leave focus alone. */
export function handlePaneCycleKey(doc: Document, e: PaneCycleKeyEvent): boolean {
  if (e.key !== "F6") return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const target = e.target as Element | null;
  if (target && typeof target.closest === "function" && target.closest("dialog")) return false;
  cyclePaneFocus(doc, e.shiftKey ? -1 : 1);
  return true;
}

/** Keep the ring on the pane that holds the keyboard focus: a `focusin`
 *  anywhere in a pane rings that pane, focus outside every pane clears it.
 *  Tab inside a pane therefore keeps the ring the F6 landing put there. */
export function syncPaneRingFromFocus(doc: Document, target: unknown): void {
  const el = target as Element | null;
  const pane = el && typeof el.closest === "function" ? el.closest(`[${PANE_ATTR}]`) : null;
  const id = pane?.getAttribute(PANE_ATTR);
  setPaneRing(
    doc,
    id !== null && id !== undefined && (PANE_ORDER as readonly string[]).includes(id) ? (id as PaneId) : null,
  );
}

/** The global handler, installed once by the shell: F6 / Shift+F6 cycles
 *  the panes, and the ring follows DOM focus. Returns the cleanup. */
export function installPaneFocusCycling(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (handlePaneCycleKey(document, e)) e.preventDefault();
  };
  const onFocusIn = (e: FocusEvent) => syncPaneRingFromFocus(document, e.target);
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("focusin", onFocusIn);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("focusin", onFocusIn);
  };
}
