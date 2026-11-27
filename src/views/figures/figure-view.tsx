// The figure editor: the grid on canvas, with a panel toolbar (add / remove /
// move / resize) and a properties panel (grid size, figure size, labels,
// title, shared legend, export DPI). The editor is the preview: panels render
// with the real graph renderers at editor scale, labels and titles drawn as
// they will export. Double-clicking a panel opens that graph's own editor;
// the figure editor itself never edits graph options — it only arranges graphs.
import * as React from "react";
import { Button, Field, Input, NumberInput, RadioList, Segmented, Select, Switch, cn } from "../../ui/controls";
import { Section, WithInspector } from "../../components/inspector";
import {
  DEFAULT_FIGURE_DPI,
  DEFAULT_FIGURE_SIZE,
  DEFAULT_LABEL_STYLE,
  FIGURE_ARRANGEMENT_PRESETS,
  FIGURE_IMAGE_MAX_DATA_URL,
  FIGURE_MAX_COLS,
  FIGURE_RESOLUTIONS,
  LABEL_POSITIONS,
  validFigureImageData,
} from "../../lib/figure";
import {
  applyFigurePreset,
  assignLabels,
  clampPanel,
  duplicateLabels,
  firstFreeCell,
  hasEmptyCell,
  isGraphPanel,
  missingPanels,
  panelsOverlap,
  parseFigurePreset,
  planFigureDrop,
  presetLabel,
  sharedLegendCheck,
  validateFigureSize,
} from "../../lib/figure";
import {
  beginFigureDrag,
  endFigureDrag,
  figureDropTargetFromPoint,
  getFigureDrag,
  getFigureDropHandler,
  registerFigureDropHandler,
  setFigureDragTarget,
  useFigureDrag,
  type FigureDropTargetRef,
} from "../../lib/figure-drag";
import { confirmReplace } from "../../native";
import { useProjectStore } from "../../store/use-project-store";
import { useZoom, ZOOM_LIMITS } from "../../store/use-zoom";
import { fitZoom } from "../../store/use-layout";
import { GRAPHS } from "../graphs";
import { DEFAULT_GRAPH_OPTIONS, clamp, type FigurePanel, type ProjectNode, type Resolution } from "../../store/types";
import { PanelPlot } from "./panel-plot";
import { frozenFigureNodes } from "./panel-figure";
import { DrawingObjectsLayer } from "../../components/drawing-objects";
import { copyFigureImage, saveFigureImage, sendFigureToOffice } from "./figure-export";
import type { OfficeTarget } from "../../lib/office-export";
import { isMacOs } from "../../lib/channel";
import { EXPORT_FORMATS, EXPORT_PRESETS, exportPreset, saveGraphImage, type ExportFormat, type ExportPreset } from "../graphs/graph-export";
import { COLOR_MODES, type ColorMode } from "../../lib/vector-export";

/** Screen pixels per inch in the editor (the figure keeps its true aspect ratio). */
const SCREEN_PX_PER_IN = 72;

/** A panel's key in the editor: its graph's id, or its kind + cell for a
 *  panel with no graph (blank / image) — those remount when they move, which
 *  costs nothing: they hold no Plotly element. */
const panelKey = (panel: FigurePanel): string =>
  (panel.kind ?? "graph") === "graph" ? panel.graphId : `${panel.kind}-${panel.row}-${panel.col}`;

/** A file read as a data URL (for an image panel's embedded picture). */
const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read the image file."));
    reader.readAsDataURL(file);
  });

export function FigureView({ node }: { node: ProjectNode }) {
  const { nodes, rootOrder, updateFigure, setActiveNode } = useProjectStore();
  const panels = node.panels ?? [];
  const grid = node.grid ?? { rows: 1, cols: 1 };
  const figureSize = node.figureSize ?? { ...DEFAULT_FIGURE_SIZE };
  const labelStyle = node.labelStyle ?? { ...DEFAULT_LABEL_STYLE };
  const figureTitle = node.figureTitle ?? "";
  const sharedLegend = node.sharedLegend ?? "none";
  const figureBackground = node.figureBackground ?? "#ffffff";
  const dpi = node.dpi ?? DEFAULT_FIGURE_DPI;

  const set = (patch: Parameters<typeof updateFigure>[1]) => updateFigure(node.id, patch);
  const setPanels = (next: FigurePanel[]) => set({ panels: next });

  // Drag-and-drop onto this figure (seq 307): a graph dragged from the
  // Navigator/sidebar, or one of this figure's own panels dragged onto
  // another cell. The drop goes through updateFigure, so Undo takes it back.
  const drag = useFigureDrag();
  const dropTarget = drag.target?.figureId === node.id ? drag.target : null;
  React.useEffect(() => {
    registerFigureDropHandler(async (source, target: FigureDropTargetRef) => {
      if (target.figureId !== node.id) return false;
      const graphIds = new Set(
        Object.values(nodes)
          .filter((n) => n.type === "graph")
          .map((n) => n.id),
      );
      const plan = planFigureDrop(panels, grid, source, target, graphIds);
      if (!plan) return false;
      if (
        plan.needsConfirm &&
        !(await confirmReplace(plan.needsConfirm.title, plan.needsConfirm.detail))
      )
        return false;
      setPanels(plan.panels);
      return true;
    });
    return () => registerFigureDropHandler(null);
    // The handler reads the panels as they are now; re-register on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, grid, nodes, node.id]);

  // A panel's own drag: pointer-based, like the sidebar's reorder drag (no
  // HTML5 drag-and-drop). A click without movement is still a click — the
  // drag only starts once the pointer moves past a few pixels.
  const panelDragRef = React.useRef<{
    startX: number;
    startY: number;
    started: boolean;
    cleanup: (() => void) | null;
  } | null>(null);
  React.useEffect(() => () => panelDragRef.current?.cleanup?.(), []);
  const startPanelDrag = (e: React.PointerEvent, panel: FigurePanel) => {
    if (e.button !== 0 || !isGraphPanel(panel)) return;
    const dragState = { startX: e.clientX, startY: e.clientY, started: false, cleanup: null as (() => void) | null };
    panelDragRef.current = dragState;
    const onMove = (ev: PointerEvent) => {
      if (!dragState.started) {
        if (Math.hypot(ev.clientX - dragState.startX, ev.clientY - dragState.startY) < 4) return;
        dragState.started = true;
        beginFigureDrag({ kind: "panel", panel });
        document.body.style.cursor = "grabbing";
      }
      setFigureDragTarget(figureDropTargetFromPoint(ev.clientX, ev.clientY));
    };
    const onUp = () => {
      dragState.cleanup?.();
      panelDragRef.current = null;
      document.body.style.cursor = "";
      if (!dragState.started) return;
      const fig = getFigureDrag();
      if (fig.source && fig.target) void getFigureDropHandler()?.(fig.source, fig.target);
      endFigureDrag();
    };
    dragState.cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dragState.cleanup = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // The grid's empty cells, as drop targets while a drag runs (a graph
  // dropped on one becomes a new panel there).
  const emptyCells = React.useMemo(() => {
    const cells: { row: number; col: number }[] = [];
    for (let row = 0; row < grid.rows; row++)
      for (let col = 0; col < grid.cols; col++)
        if (
          !panels.some(
            (p) => row >= p.row && row < p.row + p.rowSpan && col >= p.col && col < p.col + p.colSpan,
          )
        )
          cells.push({ row, col });
    return cells;
  }, [panels, grid]);

  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const selected = panels.find((p) => panelKey(p) === selectedKey) ?? null;
  const [addGraphId, setAddGraphId] = React.useState("");
  // Panels a preset dropped from the grid (seq 308): their graphs are still
  // in the project, just unassigned — listed below the preset picker until
  // they are added back (here, or through "Add a graph…").
  const [unplacedPanels, setUnplacedPanels] = React.useState<FigurePanel[]>([]);
  const [exportFormat, setExportFormat] = React.useState<ExportFormat>("png");
  const [exportPresetChoice, setExportPresetChoice] = React.useState<"custom" | ExportPreset>("custom");
  const [colorMode, setColorMode] = React.useState<ColorMode>("color");
  const [exporting, setExporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sizeError, setSizeError] = React.useState<string | null>(null);
  // The drawn panel elements, for per-panel export (the graph's own export path).
  const plottedRef = React.useRef(new Map<string, HTMLElement>());
  // The view-only zoom, shared with the View ▸ Zoom menu (seq 239): the
  // figure is scaled to the visible pane until the user zooms by hand
  // (Ctrl+scroll), which sets an explicit zoom; Reset returns to the fit.
  // The saved figure size never changes — fitting only scales the view.
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const { zoom, explicit: explicitZoom, setFit, setExplicit: setExplicitZoom } = useZoom(node.id);
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;

  // A frozen figure (seq 237) draws each panel from its snapshot: the
  // panels read their parent tables' data, so hand them the snapshot
  // tables instead of the live ones — and the snapshot graphs instead of
  // the live ones, so a graph re-frozen afterwards can't override the
  // figure's snapshot (Issue #73). Exports still use the live data
  // (the exporters render from the project, not the view).
  const figureNodes = React.useMemo(
    () => frozenFigureNodes(node, nodes),
    [nodes, node.frozen, node.frozenDataByGraph],
  );

  // Ctrl+scroll zooms by hand, as in the graph view (seq 239).
  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setExplicitZoom(clamp(zoomRef.current * (1 - e.deltaY * 0.01), ZOOM_LIMITS));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const graphs = Object.values(nodes).filter((n) => n.type === "graph");
  const available = graphs.filter((g) => !panels.some((p) => p.graphId === g.id));
  const missing = missingPanels(panels, figureNodes);
  const legend = sharedLegendCheck(panels, figureNodes);
  const dupes = duplicateLabels(panels);

  // Places a panel in the first free cell, growing a row when the grid is
  // full rather than stacking a panel on top of another.
  const insertPanel = (panel: FigurePanel) => {
    const cell = firstFreeCell(panels, grid);
    const nextGrid = cell ? grid : { rows: grid.rows + 1, cols: grid.cols };
    const placed: FigurePanel = {
      ...panel,
      row: cell ? cell.row : grid.rows,
      col: cell ? cell.col : 0,
    };
    const next = assignLabels([...panels, placed]);
    set({ panels: next, grid: nextGrid });
    setSelectedKey(panelKey(placed));
  };

  const addPanel = (graphId: string) => {
    const graph = nodes[graphId];
    if (!graph) return;
    insertPanel({
      graphId,
      graphName: graph.name,
      label: "",
      title: "",
      row: 0,
      col: 0,
      rowSpan: 1,
      colSpan: 1,
    });
    setAddGraphId("");
  };

  const addBlankPanel = () => {
    setError(null);
    insertPanel({ graphId: "", kind: "blank", label: "", title: "", row: 0, col: 0, rowSpan: 1, colSpan: 1 });
  };

  const addImagePanel = async (file: File) => {
    setError(null);
    let dataUrl: string;
    try {
      dataUrl = await readAsDataUrl(file);
    } catch {
      setError("Couldn't read the image file.");
      return;
    }
    if (!validFigureImageData(dataUrl)) {
      setError(
        dataUrl.length > FIGURE_IMAGE_MAX_DATA_URL
          ? `That image is too large to embed (at most ${FIGURE_IMAGE_MAX_DATA_URL.toLocaleString()} characters as a data URL). Use a smaller image.`
          : "That file isn't an image Titer can embed.",
      );
      return;
    }
    insertPanel({
      graphId: "",
      kind: "image",
      imageData: dataUrl,
      imageName: file.name,
      label: "",
      title: "",
      row: 0,
      col: 0,
      rowSpan: 1,
      colSpan: 1,
    });
  };

  const removePanel = (panel: FigurePanel) => {
    setPanels(panels.filter((p) => p !== panel));
    if (selectedKey === panelKey(panel)) setSelectedKey(null);
  };

  const movePanel = (panel: FigurePanel, dr: number, dc: number) => {
    const row = panel.row + dr;
    const col = panel.col + dc;
    if (row < 0 || col < 0 || row + panel.rowSpan > grid.rows || col + panel.colSpan > grid.cols) return;
    const occupant = panels.find((p) => p !== panel && row < p.row + p.rowSpan && p.row < row + panel.rowSpan && col < p.col + p.colSpan && p.col < col + panel.colSpan);
    const next = panels.map((p) => {
      if (p === panel) return { ...p, row, col };
      if (occupant && p === occupant) return { ...p, row: panel.row, col: panel.col };
      return p;
    });
    setPanels(next);
  };

  const resizePanel = (panel: FigurePanel, rowSpan: number, colSpan: number) => {
    const next = { ...panel, rowSpan: Math.max(1, rowSpan), colSpan: Math.max(1, colSpan) };
    const clamped = clampPanel(next, grid);
    if (panels.some((p) => p !== panel && panelsOverlap(clamped, p))) {
      setError("That span would overlap another panel.");
      return;
    }
    setError(null);
    setPanels(panels.map((p) => (p === panel ? clamped : p)));
  };

  const setLabel = (panel: FigurePanel, label: string) => {
    const next = panels.map((p) =>
      p === panel ? { ...p, label, labelManual: label.trim() !== "" } : p,
    );
    if (duplicateLabels(next).length) {
      setError(`Two panels can't share the label “${label}”.`);
      return;
    }
    setError(null);
    setPanels(assignLabels(next));
  };

  const changeSize = (widthIn: number | null, heightIn: number | null) => {
    const size = { widthIn: widthIn ?? figureSize.widthIn, heightIn: heightIn ?? figureSize.heightIn };
    const checked = validateFigureSize(size);
    if (checked.reason) {
      setSizeError(checked.reason);
      return;
    }
    setSizeError(null);
    set({ figureSize: checked.size! });
  };

  const changeGrid = (rows: number | null, cols: number | null) => {
    const next = {
      rows: Math.max(1, Math.min(6, rows ?? grid.rows)),
      cols: Math.max(1, Math.min(FIGURE_MAX_COLS, cols ?? grid.cols)),
    };
    set({ grid: next, panels: panels.map((p) => clampPanel(p, next)) });
  };

  // A preset only changes the grid shape — it never deletes a graph. Panels
  // that no longer fit are listed as unplaced (their graphs stay in the
  // project), and a graph unplaced by an earlier pick stays listed until it
  // is back in the figure.
  const currentPreset = FIGURE_ARRANGEMENT_PRESETS.find((p) => p.rows === grid.rows && p.cols === grid.cols) ?? null;
  const unplacedKey = (p: FigurePanel): string =>
    (p.kind ?? "graph") === "graph" ? `graph-${p.graphId}` : `${p.kind}-${p.row}-${p.col}`;
  const unplacedName = (p: FigurePanel): string =>
    (p.kind ?? "graph") === "graph"
      ? (nodes[p.graphId]?.name ?? p.graphName ?? p.graphId)
      : p.kind === "image"
        ? (p.imageName ?? "Image panel")
        : "Blank panel";
  const visibleUnplaced = unplacedPanels.filter((p) =>
    (p.kind ?? "graph") === "graph" ? !panels.some((q) => q.graphId === p.graphId) : true,
  );
  const applyPreset = (preset: { rows: number; cols: number }) => {
    const next = applyFigurePreset(panels, preset);
    set({ grid: next.grid, panels: next.panels });
    setUnplacedPanels((prev) => {
      const backIn = new Set(next.panels.map(unplacedKey));
      const merged = prev.filter((p) => !backIn.has(unplacedKey(p)));
      for (const p of next.unplaced) if (!merged.some((q) => unplacedKey(q) === unplacedKey(p))) merged.push(p);
      return merged;
    });
  };
  const reAddUnplaced = (panel: FigurePanel) => {
    insertPanel(panel);
    setUnplacedPanels((prev) => prev.filter((p) => unplacedKey(p) !== unplacedKey(panel)));
  };

  const onExport = async () => {
    setExporting(true);
    try {
      await saveFigureImage(node, nodes, exportFormat, dpi, node.name, colorMode, { rootOrder });
    } finally {
      setExporting(false);
    }
  };

  // One-click Send to Word / PowerPoint for the whole layout (v2 item 19).
  const onSendToOffice = async (target: OfficeTarget) => {
    setExporting(true);
    try {
      await sendFigureToOffice(node, nodes, target, dpi, node.name, { rootOrder });
    } finally {
      setExporting(false);
    }
  };

  const widthPx = Math.round(figureSize.widthIn * SCREEN_PX_PER_IN);
  const heightPx = Math.round(figureSize.heightIn * SCREEN_PX_PER_IN);
  const cellW = widthPx / grid.cols;
  const cellH = heightPx / grid.rows;

  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => setFit(fitZoom(el.clientWidth, el.clientHeight, widthPx, heightPx));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [widthPx, heightPx]);

  const inspector = (
    <>
      <Section title="Panels">
        <div className="flex flex-col gap-2">
          <Select
            value={addGraphId}
            onChange={(v) => setAddGraphId(v)}
            placeholder={available.length ? "Add a graph…" : "All graphs are already in this figure"}
            options={available.map((g) => ({
              value: g.id,
              label: `${nodes[g.parentId ?? ""]?.name ?? ""} — ${g.name} (${GRAPHS[g.graphType!]?.label ?? g.graphType})`,
            }))}
          />
          <Button disabled={!addGraphId} onClick={() => addGraphId && addPanel(addGraphId)}>
            Add Panel
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={addBlankPanel}>
              Add Blank Panel
            </Button>
            <label className="flex-1">
              <span className="flex cursor-pointer items-center justify-center rounded border border-separator px-2 py-1 text-regular hover:bg-hover">
                Add Image Panel…
              </span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Add an image panel"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void addImagePanel(file);
                }}
              />
            </label>
          </div>
          <p className="text-small text-secondary">
            A graph can appear in a figure only once — to use it twice, duplicate the graph first. A blank panel
            is an empty cell for layout; an image panel embeds a picture (a gel, blot or photo) beside the graphs.
            Or drag a graph from the sidebar onto a panel — or drag a panel onto another — to arrange the figure.
          </p>
          {error && <p className="text-small text-red-600">{error}</p>}
          {selected && (
            <div className="flex flex-col gap-2 border-t border-separator pt-2">
              <Field label="Label">
                <Input
                  value={selected.label}
                  aria-label="Panel label"
                  onChange={(e) => setLabel(selected, e.target.value)}
                />
              </Field>
              <p className="text-small text-secondary">
                Labels are assigned A, B, C… in reading order; a label you type sticks to the panel when it moves.
              </p>
              <Field label="Panel title">
                <Input
                  value={selected.title}
                  aria-label="Panel title"
                  placeholder="Optional"
                  onChange={(e) =>
                    setPanels(panels.map((p) => (p === selected ? { ...p, title: e.target.value } : p)))
                  }
                />
              </Field>
              <Field label="Rows spanned">
                <NumberInput
                  value={selected.rowSpan}
                  aria-label="Rows spanned"
                  onChange={(v) => v !== null && resizePanel(selected, v, selected.colSpan)}
                />
              </Field>
              <Field label="Columns spanned">
                <NumberInput
                  value={selected.colSpan}
                  aria-label="Columns spanned"
                  onChange={(v) => v !== null && resizePanel(selected, selected.rowSpan, v)}
                />
              </Field>
              <div className="flex gap-1">
                <Button onClick={() => movePanel(selected, 0, -1)}>←</Button>
                <Button onClick={() => movePanel(selected, 0, 1)}>→</Button>
                <Button onClick={() => movePanel(selected, -1, 0)}>↑</Button>
                <Button onClick={() => movePanel(selected, 1, 0)}>↓</Button>
                {(selected.kind ?? "graph") === "graph" && (
                  <Button
                    onClick={() => {
                      const graph = nodes[selected.graphId];
                      if (graph) setActiveNode(graph.id);
                    }}
                  >
                    Open Graph
                  </Button>
                )}
                <Button variant="ghost" onClick={() => removePanel(selected)}>
                  Remove
                </Button>
              </div>
            </div>
          )}
        </div>
      </Section>
      <Section title="Layout">
        <div className="flex flex-col gap-2">
          <Field label="Rows">
            <NumberInput value={grid.rows} aria-label="Grid rows" onChange={(v) => changeGrid(v, null)} />
          </Field>
          <Field label="Columns">
            <NumberInput value={grid.cols} aria-label="Grid columns" onChange={(v) => changeGrid(null, v)} />
          </Field>
          <Field label="Arrangement preset">
            <Select
              value={currentPreset ? presetLabel(currentPreset) : ""}
              onChange={(v) => {
                const preset = parseFigurePreset(v);
                if (preset) applyPreset(preset);
              }}
              placeholder="Custom arrangement"
              options={FIGURE_ARRANGEMENT_PRESETS.map((p) => ({
                value: presetLabel(p),
                label: `${presetLabel(p)} — ${p.rows * p.cols} panel${p.rows * p.cols === 1 ? "" : "s"}`,
              }))}
            />
          </Field>
          {visibleUnplaced.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-small text-secondary">
                Unplaced by the preset — the graph is still in the project, just not in this figure:
              </p>
              {visibleUnplaced.map((p) => (
                <div key={unplacedKey(p)} className="flex items-center justify-between gap-2">
                  <span className="text-small">{unplacedName(p)}</span>
                  <Button variant="ghost" onClick={() => reAddUnplaced(p)}>
                    Add back
                  </Button>
                </div>
              ))}
            </div>
          )}
          <p className="text-small text-secondary">
            A preset only changes the grid — it never deletes a graph. A graph that no longer fits is listed above,
            ready to add back.
          </p>
          <Field label="Width (in)">
            <NumberInput
              value={figureSize.widthIn}
              aria-label="Figure width in inches"
              onChange={(v) => changeSize(v, null)}
            />
          </Field>
          <Field label="Height (in)">
            <NumberInput
              value={figureSize.heightIn}
              aria-label="Figure height in inches"
              onChange={(v) => changeSize(null, v)}
            />
          </Field>
          {sizeError && <p className="text-small text-red-600">{sizeError}</p>}
          <Field label="Figure title">
            <Input
              value={figureTitle}
              aria-label="Figure title"
              placeholder="Optional"
              onChange={(e) => set({ figureTitle: e.target.value })}
            />
          </Field>
          <Field label="Background color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={figureBackground}
                aria-label="Figure background color"
                onChange={(e) => set({ figureBackground: e.target.value })}
              />
              <span className="text-small text-secondary">{figureBackground}</span>
              {node.figureBackground && (
                <Button variant="ghost" onClick={() => set({ figureBackground: undefined })}>
                  White
                </Button>
              )}
            </div>
          </Field>
          <p className="text-small text-secondary">
            Blank cells and the margins around panels show the background color, in the editor and on export.
          </p>
        </div>
      </Section>
      <Section title="Labels">
        <div className="flex flex-col gap-2">
          <Field label="Position">
            <Select
              value={labelStyle.position}
              onChange={(v) => set({ labelStyle: { ...labelStyle, position: v } })}
              options={LABEL_POSITIONS}
            />
          </Field>
          <Field label="Font size (pt)">
            <NumberInput
              value={labelStyle.fontSizePt}
              aria-label="Label font size in points"
              onChange={(v) => v !== null && set({ labelStyle: { ...labelStyle, fontSizePt: Math.max(8, Math.min(28, v)) } })}
            />
          </Field>
          <Field label="Bold">
            <Switch checked={labelStyle.bold} onChange={(v) => set({ labelStyle: { ...labelStyle, bold: v } })} />
          </Field>
        </div>
      </Section>
      <Section title="Legend">
        <div className="flex flex-col gap-2">
          <Field label="Shared legend">
            <Switch
              checked={sharedLegend === "shared"}
              disabled={sharedLegend !== "shared" && !legend.ok}
              onChange={(v) => set({ sharedLegend: v ? "shared" : "none" })}
            />
          </Field>
          {!legend.ok && sharedLegend !== "shared" && (
            <p className="text-small text-secondary">{legend.reason}</p>
          )}
          {sharedLegend === "shared" && (
            <p className="text-small text-secondary">One legend below the grid; per-panel legends are hidden.</p>
          )}
        </div>
      </Section>
      <Section title="Export">
        <div className="flex flex-col gap-2">
          <Field label="Preset">
            <Segmented
              value={exportPresetChoice}
              onChange={(v) => {
                setExportPresetChoice(v);
                if (v !== "custom") {
                  const picked = exportPreset(v)!;
                  setExportFormat(picked.format);
                  set({ dpi: picked.dpi });
                }
              }}
              options={[
                { value: "custom" as const, label: "Custom" },
                ...EXPORT_PRESETS.map((p) => ({ value: p.value, label: p.label })),
              ]}
            />
          </Field>
          <RadioList
            value={exportFormat}
            onChange={(f) => {
              setExportPresetChoice("custom");
              setExportFormat(f);
              // CMYK has no form for PNG/JPEG/SVG/BMP: picking one of
              // those drops the colour back to Color.
              if (colorMode === "cmyk" && f !== "eps" && f !== "pdf" && f !== "tiff") setColorMode("color");
            }}
            options={EXPORT_FORMATS}
          />
          <Field label="Colour">
            <Segmented
              value={colorMode}
              onChange={(v) => setColorMode(v)}
              // CMYK is offered only for the formats that have a CMYK form.
              options={
                (exportFormat === "eps" || exportFormat === "pdf" || exportFormat === "tiff"
                  ? COLOR_MODES
                  : COLOR_MODES.filter((m) => m.value !== "cmyk")
                ).map((m) => ({ value: m.value, label: m.label }))
              }
            />
          </Field>
          {exportFormat !== "svg" && exportFormat !== "eps" && exportFormat !== "pdf" && (
            <Field label="Resolution (DPI)">
              <Segmented
                value={dpi}
                onChange={(v) => {
                  setExportPresetChoice("custom");
                  set({ dpi: v });
                }}
                options={FIGURE_RESOLUTIONS.map((r) => ({ value: r as Resolution, label: `${r} DPI` }))}
              />
            </Field>
          )}
          <Button disabled={!panels.length || exporting} onClick={onExport}>
            {exporting
              ? "Exporting…"
              : exportFormat === "svg" || exportFormat === "eps" || exportFormat === "pdf"
                ? "Export Figure"
                : `Export Figure (${dpi} DPI)`}
          </Button>
          <Button
            variant="ghost"
            disabled={!panels.length || exporting}
            onClick={() => copyFigureImage(node, nodes, dpi, colorMode, { rootOrder })}
          >
            Copy Figure (PNG)
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              disabled={!panels.length || exporting}
              onClick={() => void onSendToOffice("word")}
            >
              Send to Word…
            </Button>
            <Button
              variant="ghost"
              className="flex-1"
              disabled={!panels.length || exporting}
              onClick={() => void onSendToOffice("powerpoint")}
            >
              Send to PowerPoint…
            </Button>
            {isMacOs() && (
              <Button
                variant="ghost"
                className="flex-1"
                disabled={!panels.length || exporting}
                onClick={() => void onSendToOffice("keynote")}
              >
                Send to Keynote…
              </Button>
            )}
          </div>
          <p className="text-small text-secondary">
            Send to Word / PowerPoint saves a Word or PowerPoint file with the whole figure in it.
            {isMacOs() &&
              " Send to Keynote creates the presentation in Keynote instead (macOS only) — Keynote saves the .key file."}
          </p>
          {hasEmptyCell(panels, grid) && (
            <p className="text-small text-secondary">The figure has an empty cell — it exports blank.</p>
          )}
        </div>
      </Section>
    </>
  );

  return (
    <WithInspector title={node.name} tag="Figure" node={node} settings={inspector}>
      <div className="relative min-h-0 flex-1">
        <div ref={canvasRef} className="absolute inset-0 overflow-auto bg-desk">
          {panels.length === 0 ? (
            <div
              className="flex h-full items-center justify-center"
              data-figure-drop
              data-figure-id={node.id}
              data-drop-row={0}
              data-drop-col={0}
            >
              <p className="text-regular text-secondary">
                {drag.source
                  ? "Drop a graph here to add the first panel."
                  : "This figure has no panels yet — add a graph above."}
              </p>
            </div>
          ) : (
            <div className="flex min-h-full w-max min-w-full items-center p-12">
              <div className="m-auto shrink-0">
                {figureTitle && (
                  <p className="mb-2 text-center text-large-strong">{figureTitle}</p>
                )}
                {panels.length === 1 && (
                  <p className="mb-2 text-center text-small text-secondary">
                    A figure with one panel is the same as the graph itself — export the graph instead?
                  </p>
                )}
                {missing.length > 0 && (
                  <p className="mb-2 text-center text-small text-red-600">
                    {missing.length} panel{missing.length === 1 ? "" : "s"} couldn&apos;t be drawn —{" "}
                    {missing.length === 1 ? "its" : "their"} graph is missing.
                  </p>
                )}
                {dupes.length > 0 && (
                  <p className="mb-2 text-center text-small text-red-600">
                    Duplicate label{ dupes.length === 1 ? "" : "s" }: {dupes.join(", ")}.
                  </p>
                )}
                {/* The grid at its saved size, scaled by the zoom: the wrapper takes the
                    scaled size, so the view scrolls to every edge of it. */}
                <div style={{ width: widthPx * zoom, height: heightPx * zoom }}>
                  <div
                    className="relative grid bg-white shadow-sheet"
                    style={{
                      width: widthPx,
                      height: heightPx,
                      transform: `scale(${zoom})`,
                      transformOrigin: "0 0",
                      gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
                      gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
                      background: figureBackground,
                    }}
                  >
                  {panels.map((panel) => {
                    const graph = nodes[panel.graphId];
                    const isGraph = (panel.kind ?? "graph") === "graph";
                    const w = Math.round(panel.colSpan * cellW);
                    const h = Math.round(panel.rowSpan * cellH);
                    // The cell this panel's drop target covers, highlighted while a drag hovers it.
                    const dropHovered =
                      dropTarget !== null && dropTarget.row === panel.row && dropTarget.col === panel.col;
                    return (
                      <div
                        key={panelKey(panel)}
                        data-figure-drop
                        data-figure-id={node.id}
                        data-drop-row={panel.row}
                        data-drop-col={panel.col}
                        className={cn(
                          "relative overflow-hidden ring-1 ring-separator",
                          selectedKey === panelKey(panel) && "ring-2 ring-accent",
                          dropHovered && "bg-accent/10 ring-2 ring-accent",
                          isGraph && "cursor-grab",
                        )}
                        style={{ gridRow: `${panel.row + 1} / span ${panel.rowSpan}`, gridColumn: `${panel.col + 1} / span ${panel.colSpan}` }}
                        onClick={() => setSelectedKey(panelKey(panel))}
                        onDoubleClick={() => graph && setActiveNode(graph.id)}
                        onPointerDown={(e) => startPanelDrag(e, panel)}
                      >
                        {!isGraph && panel.kind === "blank" ? (
                          <>
                            <div className="flex h-full w-full items-center justify-center">
                              <p className="text-small text-secondary">Blank panel</p>
                            </div>
                            <span className="absolute top-1 left-2 text-regular font-bold">{panel.label}</span>
                            {panel.title && (
                              <span className="absolute top-1 left-1/2 -translate-x-1/2 text-small font-bold">
                                {panel.title}
                              </span>
                            )}
                          </>
                        ) : !isGraph && panel.kind === "image" ? (
                          <>
                            {panel.imageData ? (
                              <img
                                src={panel.imageData}
                                alt={panel.imageName ?? "Image panel"}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <p className="text-small text-secondary">No image yet</p>
                              </div>
                            )}
                            <span className="absolute top-1 left-2 text-regular font-bold">{panel.label}</span>
                            {panel.title && (
                              <span className="absolute top-1 left-1/2 -translate-x-1/2 text-small font-bold">
                                {panel.title}
                              </span>
                            )}
                          </>
                        ) : !graph ? (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-white px-2 text-center">
                            <p className="text-regular">Graph deleted — pick a replacement</p>
                            <p className="text-small text-secondary">
                              {panel.graphName ? `“${panel.graphName}” is missing.` : "The graph this panel showed is gone."}
                            </p>
                            <Button variant="ghost" onClick={() => removePanel(panel)}>
                              Remove Panel
                            </Button>
                          </div>
                        ) : (
                          <>
                            <PanelPlot
                              graph={figureNodes[panel.graphId] ?? graph}
                              nodes={figureNodes}
                              width={w}
                              height={h}
                              hideLegend={sharedLegend === "shared" && legend.ok}
                              onPlot={(el) => {
                                if (el) plottedRef.current.set(panel.graphId, el);
                                else plottedRef.current.delete(panel.graphId);
                              }}
                            />
                            <span className="absolute top-1 left-2 text-regular font-bold">{panel.label}</span>
                            {panel.title && (
                              <span className="absolute top-1 left-1/2 -translate-x-1/2 text-small font-bold">
                                {panel.title}
                              </span>
                            )}
                            <button
                              type="button"
                              className="absolute right-1 bottom-1 rounded bg-black/60 px-1.5 py-0.5 text-small text-white"
                              title="Export this panel (the graph's own export)"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                const el = plottedRef.current.get(panel.graphId);
                                const options = { ...DEFAULT_GRAPH_OPTIONS, ...graph.graphOptions };
                                if (el) void saveGraphImage(el, { width: options.width, height: options.height }, exportFormat, dpi, graph.name, colorMode);
                              }}
                            >
                              Export panel
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                  {/* The grid's empty cells: drop targets while a drag runs — a
                      graph dropped on one becomes a new panel there. */}
                  {emptyCells.map(({ row, col }) => {
                    const hovered = dropTarget !== null && dropTarget.row === row && dropTarget.col === col;
                    return (
                      <div
                        key={`empty-${row}-${col}`}
                        data-figure-drop
                        data-figure-id={node.id}
                        data-drop-row={row}
                        data-drop-col={col}
                        aria-label={`Empty cell, row ${row + 1}, column ${col + 1}`}
                        className={cn(
                          "relative flex items-center justify-center border border-dashed",
                          drag.source ? "border-separator" : "border-transparent",
                          hovered && "border-accent bg-accent/10 ring-2 ring-accent",
                        )}
                        style={{ gridRow: `${row + 1}`, gridColumn: `${col + 1}` }}
                      >
                        {drag.source && (
                          <p className="px-2 text-center text-small text-secondary">Drop a graph here</p>
                        )}
                      </div>
                    );
                  })}
                  {/* Drawing objects (seq 238), pinned to the figure in its own
                      px: screen-only, like on a graph, never exported. */}
                  <DrawingObjectsLayer node={node} zoom={zoom} />
                </div>
                </div>
                {sharedLegend === "shared" && legend.entries && (
                  <div className="mt-2 flex justify-center gap-4 text-small">
                    {legend.entries.map((e) => (
                      <span key={e.name} className="flex items-center gap-1">
                        <span className="inline-block size-2.5" style={{ background: e.color }} />
                        {e.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {explicitZoom !== null && (
          <button
            type="button"
            onClick={() => setExplicitZoom(null)}
            title="Reset zoom to fit"
            className="absolute right-3 bottom-3 z-20 rounded-full bg-black/70 px-2.5 py-1 text-small text-white hover:bg-black/80"
          >
            {Math.round(zoom * 100)}%
          </button>
        )}
      </div>
    </WithInspector>
  );
}
