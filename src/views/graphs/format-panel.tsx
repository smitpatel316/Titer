// A graph's Format panel. Every graph has the same sections in the same order:
// Statistics · Data · Style · Series · Selected points · Text · Axes · Export. A
// section with nothing for this graph (or no point selected) is left out, the others
// never move. Which sections are open is one
// app-wide preference, kept across graphs and launches; Statistics starts open.
import * as React from "react";
import {
  ChartBarIcon,
  CursorClickIcon,
  ExportIcon,
  PaintBrushIcon,
  PaletteIcon,
  RulerIcon,
  SigmaIcon,
  TextTIcon,
} from "@phosphor-icons/react";
import { Button, Select } from "../../ui/controls";
import { titleCase } from "../../lib/format";
import { Row, Section, Stepper } from "../../components/inspector";
import { useProjectStore } from "../../store/use-project-store";
import { allConstantNames } from "../../lib/info-sheets";
import { paletteColor, paletteOf, reversedPalette, savedPalette, withoutColors } from "../../lib/palettes";
import {
  GRAPH_LIMITS,
  MAX_REF_LINES,
  REF_LABEL_PLACES,
  SAME_AS_FILL,
  type AxisNumberFormat,
  type GraphOptions,
  type GraphPalette,
  type PointStyle,
  type RefLine,
  type SeriesStyle,
} from "../../store/types";
import { GRAPHS, hasValueAxis, newGraphOptions } from ".";
import {
  EXPORT_FORMATS,
  EXPORT_PRESETS,
  EXPORT_SIZE_PRESETS,
  RESOLUTIONS,
  exportFinalWidthIn,
  exportPreset,
  type ExportFormat,
  type ExportPreset,
  type ExportSizePreset,
  type ExportSizeUnit,
  type Resolution,
} from "./graph-export";
import { COLOR_MODES, type ColorMode } from "../../lib/vector-export";
import type { OfficeTarget } from "../../lib/office-export";
import { isMacOs } from "../../lib/channel";
import {
  Choice,
  ColorRow,
  ColumnSelectRow,
  DashRow,
  Group,
  NumRow,
  OutlineRows,
  PercentRow,
  PaletteRow,
  SeriesHeader,
  SeriesRow,
  SizeRow,
  TextRow,
  ThicknessRow,
  Toggle,
} from "./panel-controls";
import { axesRangeInputs, hasTableXAxis, logScaleOffered, rightYDataset } from "./plot-helpers";
import { dataControls, statisticsControls, styleControls, type SectionContext } from "./format-sections";
import {
  DATE_DISPLAY_FORMAT_LABELS,
  DATE_DISPLAY_FORMATS,
  ELAPSED_DISPLAY_FORMAT_LABELS,
  ELAPSED_DISPLAY_FORMATS,
} from "../../lib/axis-dates";
import { VOLCANO_SERIES } from "./volcano";
import { MatchSection } from "./match-graph";
import { useLayout } from "../../store/use-layout";

/** The points selected on the graph: how many, the first one's style (shown), whether
 *  any has its own, and how to set, resize (each from its own size) or reset theirs. */
interface Selection {
  count: number;
  style: Required<Omit<PointStyle, "labelOffset">>;
  styled: boolean;
  set: (style: PointStyle) => void;
  resize: (by: number) => void;
  reset: () => void;
}

interface Props extends SectionContext {
  graphId: string;
  setSeriesStyle: (key: string, style: SeriesStyle) => void;
  selection?: Selection;
  canExport: boolean;
  /** Save / copy at the export's final width (`widthIn` undefined = the
   *  graph's own size). */
  onSave: (format: ExportFormat, dpi: Resolution, colorMode: ColorMode, widthIn?: number) => void;
  onCopy: (dpi: Resolution, colorMode: ColorMode, widthIn?: number) => void;
  /** The table's series, in order: each shown one takes its place's color. */
  allSeries: string[];
  /** Where a new reference line goes: the middle of the value axis as drawn. */
  newLineAt: number;
  /** One-click Send to Word / PowerPoint (v2 item 19). */
  onSendToOffice?: (target: OfficeTarget, dpi: Resolution) => void;
}

// What the Style section sets, put back by its Reset.
const STYLE_OPTIONS: (keyof GraphOptions)[] = [
  "shape",
  "kind",
  "whisker",
  "xyStyle",
  "residualsAs",
  "groupLayout",
  "bars",
  "showPoints",
  "fill",
  "pointShape",
  "pointSize",
  "pointOutline",
  "pointOutlineColor",
  "pointFill",
  "outline",
  "outlineColor",
  "barGap",
  "lineWidth",
  "lineDash",
  "errorWidth",
  "errorCaps",
  "errorColor",
  "errorDirection",
  "survivalShowCensors",
  "survivalShowBand",
  "survivalShowAtRisk",
  "pieShowPercent",
  "heatmapShowValues",
  "heatmapShowScale",
  "volcanoLabelCount",
];

// This Mac's preferences, never the project's: the format and resolution of the last export.
const EXPORT_KEY = "titer.graph.export";

/** The sections, in their one order (each shown only when it has something for the graph). */
export const SECTIONS = ["Statistics", "Data", "Style", "Series", "Selected points", "Text", "Axes", "Match", "Export"];
type ExportChoice = {
  format: ExportFormat;
  dpi: Resolution;
  colorMode: ColorMode;
  preset: "custom" | ExportPreset;
  /** The export's final width (seq 294): the graph's own size, a preset,
   *  or a custom value in inches or cm. */
  size: ExportSizePreset;
  customWidth?: number;
  customUnit: ExportSizeUnit;
};
function readExport(): ExportChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPORT_KEY) ?? "{}");
    return {
      format: EXPORT_FORMATS.some((f) => f.value === saved.format) ? saved.format : "png",
      dpi: RESOLUTIONS.includes(saved.dpi) ? saved.dpi : "300",
      colorMode: COLOR_MODES.some((m) => m.value === saved.colorMode) ? saved.colorMode : "color",
      preset: EXPORT_PRESETS.some((p) => p.value === saved.preset) ? saved.preset : "custom",
      size: EXPORT_SIZE_PRESETS.some((p) => p.value === saved.size) ? saved.size : "graph",
      customWidth:
        typeof saved.customWidth === "number" && saved.customWidth > 0 ? saved.customWidth : undefined,
      customUnit: saved.customUnit === "cm" ? "cm" : "in",
    };
  } catch {
    return { format: "png", dpi: "300", colorMode: "color", preset: "custom", size: "graph", customUnit: "in" };
  }
}

function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not remembered; still works
  }
}

export function FormatPanel(props: Props) {
  const { graphType, options, set, seriesNames, setSeriesStyle, selection } = props;
  const { family, horizontal, placesRows } = GRAPHS[graphType];
  // The keys of an axis as shown: horizontal bars keep their value axis's in y, their rows' in x.
  const keyOf = (shown: "X" | "Y") => ((shown === "X") === !horizontal ? "x" : "y");
  // The project's info constants, for the axis-limit hook pickers below.
  const { nodes, rootOrder } = useProjectStore();
  const constants = React.useMemo(() => allConstantNames(nodes, rootOrder), [nodes, rootOrder]);
  const constantItems = constants.map((name) => ({ value: name, label: name }));
  const hasAxes = family !== "pie";
  // The primary table's X format (seq 332): a date/elapsed X turns the X
  // axis into a date/elapsed scale — no log scale, no number format, and
  // the display format picker below (only where the graph's X is the
  // table's X column at all).
  const xFormat = React.useMemo(() => {
    const graph = nodes[props.graphId];
    const parent = graph?.parentId ? nodes[graph.parentId] : undefined;
    return parent?.data?.xFormat;
  }, [nodes, props.graphId]);
  const isDateX = xFormat === "date" || xFormat === "elapsed";
  // The data set on the right Y axis, if the pick is still a series (a stale or
  // renamed name silently falls back to the left axis — see rightYDataset).
  const right = family === "xy" ? rightYDataset(options, seriesNames) : undefined;
  const [exported, setExported] = React.useState(readExport);
  const chooseExport = (choice: Partial<ExportChoice>) => {
    // Picking a format or resolution by hand leaves the preset behind.
    const next = {
      ...exported,
      ...choice,
      preset:
        choice.preset ?? (choice.format !== undefined || choice.dpi !== undefined ? "custom" : exported.preset),
    };
    setExported(next);
    remember(EXPORT_KEY, next);
  };

  // A section folds or unfolds by its title; with ⌥, every section does the same.
  const { openSections: open, setOpenSections } = useLayout();
  const fold = (title: string) => ({
    collapsed: !open.has(title),
    onToggle: (all: boolean) => {
      const opening = !open.has(title);
      const next = new Set(open);
      for (const t of all ? SECTIONS : [title]) {
        if (opening) next.add(t);
        else next.delete(t);
      }
      setOpenSections(next);
    },
  });

  // A section's Reset, shown once one of its settings differs from what a new graph
  // of this type starts with.
  const fresh = newGraphOptions(graphType);
  const reset = (keys: (keyof GraphOptions)[]) =>
    keys.some((k) => options[k] !== fresh[k]) && (
      <Button variant="ghost" size="small" onClick={() => set(Object.fromEntries(keys.map((k) => [k, fresh[k]])))}>
        Reset
      </Button>
    );

  const palette = paletteOf(options);
  // What each series offers besides its color, while the graph draws it: its points'
  // shape, its line's dashes (a Mean & error line is one gray connector, not a series'),
  // the pattern over its fill — and, where the graph summarizes (seq 375), its own
  // center and error bars (Default = the graph's choice).
  const module = GRAPHS[graphType];
  const offer = {
    shape: module.points?.(options),
    dash: module.lines?.(options) && family !== "column",
    pattern: module.patterns?.(options),
    center: module.summarizes?.(options),
    error: module.summarizes?.(options),
  };
  const statistics = statisticsControls(props);
  const data = dataControls(props);
  const style = styleControls(props);

  return (
    <>
      {statistics && (
        <Section title="Statistics" icon={<SigmaIcon />} {...fold("Statistics")}>
          {statistics}
        </Section>
      )}

      {data && (
        <Section title="Data" icon={<ChartBarIcon />} {...fold("Data")}>
          {data}
        </Section>
      )}

      {style && (
        <Section title="Style" icon={<PaintBrushIcon />} {...fold("Style")} action={reset(STYLE_OPTIONS)}>
          {style}
        </Section>
      )}

      {(seriesNames.length > 0 || family === "heatmap") && (
        <Section title="Series" icon={<PaletteIcon />} {...fold("Series")} action={reset(["series"])}>
          {/* A new palette drops the colors picked by hand, not the rest of their style. */}
          <PaletteRow
            value={palette}
            gradients={family === "heatmap"}
            onChange={(p) => set({ palette: savedPalette(p), series: withoutColors(options.series) })}
            onReverse={() => set({ palette: reversedPalette(palette), series: withoutColors(options.series) })}
          />
          {seriesNames.length > 0 && <SeriesHeader offer={offer} />}
          {seriesNames.map((name) => {
            const own = options.series?.[name];
            return (
              <SeriesRow
                key={name}
                label={family === "volcano" ? VOLCANO_SERIES[name] : name}
                palette={palette}
                style={{
                  // Its color is its place's among the table's series (`allSeries`).
                  color:
                    own?.color ??
                    paletteColor(palette, Math.max(0, props.allSeries.indexOf(name)), props.allSeries.length),
                  shape: own?.shape ?? options.pointShape,
                  dash: own?.dash ?? options.lineDash,
                  pattern: own?.pattern,
                }}
                offer={offer}
                center={options.center}
                error={options.error}
                own={own}
                onChange={(style) => setSeriesStyle(name, style)}
              />
            );
          })}
        </Section>
      )}

      {selection && (
        <Section
          title={`Selected points (${selection.count})`}
          icon={<CursorClickIcon />}
          {...fold("Selected points")}
          action={
            selection.styled && (
              <Button variant="ghost" size="small" onClick={selection.reset}>
                Reset
              </Button>
            )
          }
        >
          {/* The same controls as for every point (Style) and each series (Series). */}
          <SeriesHeader offer={{ shape: true }} />
          <SeriesRow
            label="Mark"
            palette={palette}
            style={{ ...selection.style, dash: options.lineDash }}
            offer={{ shape: true }}
            center={options.center}
            error={options.error}
            onChange={({ color, shape }) => selection.set(color ? { color } : { shape })}
          />
          <Stepper
            label="Size"
            value={selection.style.size}
            {...GRAPH_LIMITS.pointSize}
            step={1}
            onChange={(size) => selection.resize(size - selection.style.size)}
          />
          <PercentRow
            label="Fill"
            value={selection.style.fill}
            limits={GRAPH_LIMITS.pointFill}
            onChange={(fill) => selection.set({ fill })}
          />
          <OutlineRows
            palette={palette}
            width={selection.style.outline}
            limits={GRAPH_LIMITS.pointOutline}
            color={selection.style.outlineColor}
            onWidth={(outline) => selection.set({ outline })}
            onColor={(outlineColor, outline) => selection.set({ outlineColor, ...(outline && { outline }) })}
          />
          <Toggle
            label="Show label"
            checked={selection.style.label}
            onChange={(label) => selection.set({ label: label || undefined })}
          />
        </Section>
      )}

      <Section
        title="Text"
        icon={<TextTIcon />}
        {...fold("Text")}
        action={reset(["fontSize", "xTitleGap", "yTitleGap", "legend", "note"])}
      >
        <TextRow label="Title" value={options.title} onChange={(title) => set({ title })} />
        {constants.length > 0 && (
          <p className="text-small text-secondary">
            {"{{Constant name}}"} in a title or axis title pulls that info constant&rsquo;s value, live.
          </p>
        )}
        {hasAxes && (
          <>
            {(["X", "Y"] as const).map((shown) => (
              <TextRow
                key={shown}
                label={`${shown} axis title`}
                value={options[`${keyOf(shown)}Label`]}
                onChange={(label) => set({ [`${keyOf(shown)}Label`]: label })}
              />
            ))}
            {(["X", "Y"] as const).map((shown) => (
              <Stepper
                key={shown}
                label={`${shown} title spacing`}
                value={options[`${keyOf(shown)}TitleGap`]}
                {...GRAPH_LIMITS[`${keyOf(shown)}TitleGap`]}
                step={2}
                onChange={(gap) => set({ [`${keyOf(shown)}TitleGap`]: gap })}
              />
            ))}
          </>
        )}
        <Stepper
          label="Font size"
          value={options.fontSize}
          {...GRAPH_LIMITS.fontSize}
          step={1}
          onChange={(fontSize) => set({ fontSize })}
        />
      </Section>

      {hasAxes && (
        <Section
          title="Axes"
          icon={<RulerIcon />}
          {...fold("Axes")}
          action={reset([
            "yMin",
            "yMax",
            "yStep",
            "xMin",
            "xMax",
            "xStep",
            "yMinConstant",
            "yMaxConstant",
            "xMinConstant",
            "xMaxConstant",
            "xScale",
            "yScale",
            "xDateFormat",
            "xElapsedFormat",
            "xNumberFormat",
            "yNumberFormat",
            "y2NumberFormat",
            "axisWidth",
            "refLines",
            "rightYDataset",
            "y2Label",
            "y2Scale",
            "y2Min",
            "y2Max",
            "y2Step",
            "gridX",
            "gridY",
            "tickDirection",
            "tickLength",
          ])}
        >
          {family !== "heatmap" && family !== "volcano" && logScaleOffered(graphType).y && (
            <Scale
              axis="Y"
              value={options.yScale}
              leftOut={props.logLeftOut.y}
              onChange={(yScale) => set({ yScale })}
            />
          )}
          {family !== "heatmap" && axesRangeInputs(graphType).y && (
            <AxisRange
              axis="Y"
              min={options.yMin}
              max={options.yMax}
              step={options.yStep}
              log={family !== "volcano" && options.yScale !== "linear"}
              minHook={options.yMinConstant}
              maxHook={options.yMaxConstant}
              constants={constantItems}
              onChange={(yMin, yMax, yStep) => set({ yMin, yMax, yStep })}
              onHookChange={(yMinConstant, yMaxConstant) => set({ yMinConstant, yMaxConstant })}
            />
          )}
          {family !== "heatmap" && axesRangeInputs(graphType).y && (
            <NumberFormat
              axis="Y"
              value={options.yNumberFormat}
              onChange={(yNumberFormat) => set({ yNumberFormat })}
            />
          )}
          {placesRows && props.atValues && (
            <Choice
              label="X axis"
              value={options.rowsAt}
              onChange={(rowsAt) => set({ rowsAt })}
              items={[
                { value: "order", label: "Categories" },
                { value: "values", label: "Numbers" },
              ]}
            />
          )}
          {family === "xy" && !isDateX && logScaleOffered(graphType).x && (
            <Scale
              axis="X"
              value={options.xScale}
              leftOut={props.logLeftOut.x}
              onChange={(xScale) => set({ xScale })}
            />
          )}
          {(family === "xy" || family === "volcano" || family === "histogram" || family === "multiple") &&
            axesRangeInputs(graphType).x && (
              <>
                <AxisRange
                  axis="X"
                  min={options.xMin}
                  max={options.xMax}
                  step={options.xStep}
                  log={family === "xy" && options.xScale !== "linear"}
                  minHook={options.xMinConstant}
                  maxHook={options.xMaxConstant}
                  constants={constantItems}
                  onChange={(xMin, xMax, xStep) => set({ xMin, xMax, xStep })}
                  onHookChange={(xMinConstant, xMaxConstant) => set({ xMinConstant, xMaxConstant })}
                />
                {!isDateX && (
                  <NumberFormat
                    axis="X"
                    value={options.xNumberFormat}
                    onChange={(xNumberFormat) => set({ xNumberFormat })}
                  />
                )}
                {hasTableXAxis(graphType, options) && xFormat === "date" && (
                  <>
                    <Choice
                      label="X date format"
                      value={options.xDateFormat}
                      onChange={(xDateFormat) => set({ xDateFormat })}
                      items={DATE_DISPLAY_FORMATS.map((value) => ({ value, label: DATE_DISPLAY_FORMAT_LABELS[value] }))}
                      wrap
                    />
                    <p className="text-small text-secondary">
                      Ticks are spaced automatically on a date axis; the step setting above is ignored.
                    </p>
                  </>
                )}
                {hasTableXAxis(graphType, options) && xFormat === "elapsed" && (
                  <>
                    <Choice
                      label="X elapsed format"
                      value={options.xElapsedFormat}
                      onChange={(xElapsedFormat) => set({ xElapsedFormat })}
                      items={ELAPSED_DISPLAY_FORMATS.map((value) => ({ value, label: ELAPSED_DISPLAY_FORMAT_LABELS[value] }))}
                    />
                    <p className="text-small text-secondary">
                      Ticks are spaced automatically on an elapsed-time axis; the step setting above is ignored.
                    </p>
                  </>
                )}
              </>
            )}
          {family === "xy" && seriesNames.length >= 2 && (
            <ColumnSelectRow
              label="Right Y axis"
              value={right}
              names={seriesNames}
              allowNone
              onChange={(rightYDataset) => set({ rightYDataset })}
            />
          )}
          {family === "xy" && right && (
            <>
              <TextRow
                label="Right Y axis title"
                value={options.y2Label ?? ""}
                onChange={(y2Label) => set({ y2Label })}
              />
              <Scale
                axis="Right"
                value={options.y2Scale}
                leftOut={props.logLeftOut.y2}
                onChange={(y2Scale) => set({ y2Scale })}
              />
              <AxisRange
                axis="Right"
                min={options.y2Min}
                max={options.y2Max}
                step={options.y2Step}
                log={options.y2Scale !== "linear"}
                constants={[]}
                onChange={(y2Min, y2Max, y2Step) => set({ y2Min, y2Max, y2Step })}
                // The right axis has no hook fields (no y2MinConstant /
                // y2MaxConstant in GraphOptions), so it offers no hooks:
                // an empty list hides the hook rows, and this never fires.
                onHookChange={() => {}}
              />
              <NumberFormat
                axis="Right"
                value={options.y2NumberFormat}
                onChange={(y2NumberFormat) => set({ y2NumberFormat })}
              />
            </>
          )}
          <ThicknessRow
            label="Axis thickness"
            value={options.axisWidth}
            limits={GRAPH_LIMITS.axisWidth}
            onChange={(axisWidth) => set({ axisWidth })}
          />
          {hasValueAxis(family) && (
            <RefLines
              lines={options.refLines ?? []}
              axis={horizontal ? "X" : "Y"}
              at={props.newLineAt}
              palette={paletteOf(options)}
              onChange={(lines) => set({ refLines: lines.length ? lines : undefined })}
            />
          )}
          <Choice
            label="X gridlines"
            value={options.gridX}
            onChange={(gridX) => set({ gridX })}
            items={[
              { value: "none", label: "None" },
              { value: "major", label: "Major" },
              { value: "major-minor", label: "Major + minor" },
            ]}
          />
          <Choice
            label="Y gridlines"
            value={options.gridY}
            onChange={(gridY) => set({ gridY })}
            items={[
              { value: "none", label: "None" },
              { value: "major", label: "Major" },
              { value: "major-minor", label: "Major + minor" },
            ]}
          />
          <Choice
            label="Tick direction"
            value={options.tickDirection}
            onChange={(tickDirection) => set({ tickDirection })}
            items={[
              { value: "outside", label: "Outside" },
              { value: "inside", label: "Inside" },
              { value: "none", label: "None" },
            ]}
          />
          <Stepper
            label="Tick length"
            value={options.tickLength}
            {...GRAPH_LIMITS.tickLength}
            step={1}
            onChange={(tickLength) => set({ tickLength })}
          />
        </Section>
      )}

      <MatchSection key={props.graphId} graphId={props.graphId} set={set} {...fold("Match")} />

      <Section
        title="Export"
        icon={<ExportIcon />}
        {...fold("Export")}
        action={reset(["width", "height", "background"])}
      >
        <SizeRow width={options.width} height={options.height} onChange={set} />
        <Choice
          label="Background"
          value={options.background}
          onChange={(background) => set({ background })}
          items={[
            { value: "white", label: "White" },
            { value: "transparent", label: "Transparent" },
          ]}
        />
        <Choice
          label="Preset"
          value={exported.preset}
          onChange={(preset) =>
            preset === "custom"
              ? chooseExport({ preset: "custom" })
              : chooseExport({ preset, ...exportPreset(preset)! })
          }
          items={[
            { value: "custom" as const, label: "Custom" },
            ...EXPORT_PRESETS.map((p) => ({ value: p.value, label: p.label })),
          ]}
        />
        <Choice
          label="Format"
          value={exported.format}
          onChange={(format) =>
            chooseExport({
              format,
              // CMYK has no form for PNG/JPEG/SVG/BMP: picking one of
              // those drops the colour back to Color.
              ...(exported.colorMode === "cmyk" && format !== "eps" && format !== "pdf" && format !== "tiff"
                ? { colorMode: "color" as const }
                : {}),
            })
          }
          items={EXPORT_FORMATS}
        />
        <Choice
          label="Colour"
          value={exported.colorMode}
          onChange={(colorMode) => chooseExport({ colorMode })}
          // CMYK is offered only for the formats that have a CMYK form.
          items={
            exported.format === "eps" || exported.format === "pdf" || exported.format === "tiff"
              ? COLOR_MODES
              : COLOR_MODES.filter((m) => m.value !== "cmyk")
          }
        />
        {exported.format !== "svg" && exported.format !== "eps" && exported.format !== "pdf" && (
          <Choice
            label="Resolution (DPI)"
            value={exported.dpi}
            onChange={(dpi) => chooseExport({ dpi })}
            items={RESOLUTIONS.map((dpi) => ({ value: dpi, label: dpi }))}
          />
        )}
        <Choice
          label="Size (final width)"
          value={exported.size}
          onChange={(size) => chooseExport({ size })}
          items={[...EXPORT_SIZE_PRESETS]}
          wrap
        />
        {exported.size === "custom" && (
          <>
            <NumRow
              label="Custom width"
              value={exported.customWidth}
              onChange={(customWidth) => chooseExport({ customWidth })}
            />
            <Choice
              label="Unit"
              value={exported.customUnit}
              onChange={(customUnit) => chooseExport({ customUnit })}
              items={[
                { value: "in" as const, label: "inches" },
                { value: "cm" as const, label: "cm" },
              ]}
            />
          </>
        )}
        <div className="flex gap-2">
          <Button
            variant="accent"
            className="flex-1"
            disabled={!props.canExport}
            onClick={() =>
              props.onSave(
                exported.format,
                exported.dpi,
                exported.colorMode,
                exportFinalWidthIn(exported.size, exported.customWidth, exported.customUnit),
              )
            }
          >
            Save…
          </Button>
          <Button
            className="flex-1"
            disabled={!props.canExport}
            onClick={() =>
              props.onCopy(
                exported.dpi,
                exported.colorMode,
                exportFinalWidthIn(exported.size, exported.customWidth, exported.customUnit),
              )
            }
          >
            Copy
          </Button>
        </div>
        {props.onSendToOffice && (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!props.canExport}
              onClick={() => props.onSendToOffice!("word", exported.dpi)}
            >
              Send to Word…
            </Button>
            <Button
              className="flex-1"
              disabled={!props.canExport}
              onClick={() => props.onSendToOffice!("powerpoint", exported.dpi)}
            >
              Send to PowerPoint…
            </Button>
            {isMacOs() && (
              <Button
                className="flex-1"
                disabled={!props.canExport}
                onClick={() => props.onSendToOffice!("keynote", exported.dpi)}
              >
                Send to Keynote…
              </Button>
            )}
          </div>
        )}
        <p className="text-small text-secondary">
          Send to Word / PowerPoint saves a Word or PowerPoint file with the graph in it — open it in Word or
          PowerPoint.
          {isMacOs() &&
            " Send to Keynote creates the presentation in Keynote instead (macOS only) — Keynote saves the .key file."}
        </p>
      </Section>
    </>
  );
}

/** One axis's Min / Max / Step; a blank field is Auto. With info constants
 *  in the project, each limit can instead be hooked to a constant — the
 *  axis follows the constant's value, live. */
function AxisRange({
  axis,
  min,
  max,
  step,
  log,
  minHook,
  maxHook,
  constants,
  onChange,
  onHookChange,
}: {
  axis: "X" | "Y" | "Right";
  min?: number;
  max?: number;
  step?: number;
  log: boolean;
  minHook?: string;
  maxHook?: string;
  constants: { value: string; label: string }[];
  onChange: (min?: number, max?: number, step?: number) => void;
  onHookChange: (minHook?: string, maxHook?: string) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <NumRow label={`${axis} min`} value={min} onChange={(v) => onChange(v, max, step)} />
        <NumRow label={`${axis} max`} value={max} onChange={(v) => onChange(min, v, step)} />
        {!log && <NumRow label={`${axis} step`} value={step} onChange={(v) => onChange(min, max, v)} />}
      </div>
      {constants.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <HookRow
            label={`${axis} min from`}
            value={minHook ?? ""}
            constants={constants}
            onChange={(v) => onHookChange(v || undefined, maxHook)}
          />
          <HookRow
            label={`${axis} max from`}
            value={maxHook ?? ""}
            constants={constants}
            onChange={(v) => onHookChange(minHook, v || undefined)}
          />
        </div>
      )}
    </>
  );
}

/** One limit's info-constant hook: a constant's value, or "None" for the typed number. */
function HookRow({
  label,
  value,
  constants,
  onChange,
}: {
  label: string;
  value: string;
  constants: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-small text-secondary">{label}</span>
      <div className="min-w-0 flex-1">
        <Select value={value} onChange={onChange} options={constants} placeholder="None" />
      </div>
    </div>
  );
}

/** The reference lines across the plot: for each, where (on the value axis, `axis`), its
 *  text, dashes, thickness and color (none: the axes'); added at `at`, removed one by one. */
function RefLines({
  lines,
  axis,
  at,
  palette,
  onChange,
}: {
  lines: RefLine[];
  axis: "X" | "Y";
  at: number;
  palette: GraphPalette;
  onChange: (lines: RefLine[]) => void;
}) {
  const change = (i: number, line: Partial<RefLine>) =>
    onChange(lines.map((l, k) => (k === i ? { ...l, ...line } : l)));
  return (
    <>
      {lines.map((l, i) => (
        <Group key={i} title={lines.length > 1 ? `Reference line ${i + 1}` : "Reference line"}>
          <NumRow
            label={`At ${axis}`}
            value={l.value}
            required
            onChange={(value) => value !== undefined && change(i, { value })}
          />
          <TextRow label="Text" value={l.label ?? ""} onChange={(label) => change(i, { label: label || undefined })} />
          {l.label && (
            <Row label="Text place">
              <Select
                value={l.labelPlace ?? "top-right"}
                onChange={(labelPlace) => change(i, { labelPlace })}
                options={REF_LABEL_PLACES.map((p) => ({ value: p, label: titleCase(p.replace("-", " ")) }))}
              />
            </Row>
          )}
          <DashRow value={l.dash} onChange={(dash) => change(i, { dash })} />
          <ThicknessRow
            label="Thickness"
            value={l.width}
            limits={GRAPH_LIMITS.lineWidth}
            onChange={(width) => change(i, { width })}
          />
          <ColorRow
            label="Color"
            palette={palette}
            color={l.color}
            same="Same as Axes"
            onChange={(color) => change(i, { color: color === SAME_AS_FILL ? undefined : color })}
          />
          <Button onClick={() => onChange(lines.filter((_, k) => k !== i))}>Remove Line</Button>
        </Group>
      ))}
      {lines.length < MAX_REF_LINES && (
        <Button onClick={() => onChange([...lines, { value: at, dash: "dash", width: 1 }])}>Add Reference Line</Button>
      )}
    </>
  );
}

/** An axis's number format: automatic, a fixed number of decimal places,
 *  or scientific notation. Back to Automatic clears the format (the file
 *  stays lean — an absent format reads as automatic). */
function NumberFormat({
  axis,
  value,
  onChange,
}: {
  axis: "X" | "Y" | "Right";
  value: AxisNumberFormat | undefined;
  onChange: (v: AxisNumberFormat | undefined) => void;
}) {
  const format = value?.format ?? "auto";
  return (
    <>
      <Choice
        label={`${axis} number format`}
        value={format}
        onChange={(f) => onChange(f === "auto" ? undefined : { format: f, decimals: value?.decimals ?? 2 })}
        items={[
          { value: "auto", label: "Automatic" },
          { value: "decimal", label: "Decimal places" },
          { value: "scientific", label: "Scientific" },
        ]}
      />
      {format !== "auto" && (
        <Stepper
          label="Decimal places"
          value={value?.decimals ?? 2}
          min={0}
          max={15}
          step={1}
          onChange={(decimals) => onChange({ format, decimals })}
        />
      )}
    </>
  );
}

/** An axis's scale, and how many values a log scale can't show. */
function Scale({
  axis,
  value,
  leftOut,
  onChange,
}: {
  axis: "X" | "Y" | "Right";
  value: GraphOptions["xScale"];
  leftOut: number;
  onChange: (scale: GraphOptions["xScale"]) => void;
}) {
  return (
    <>
      <Choice
        label={`${axis} scale`}
        value={value}
        onChange={onChange}
        items={[
          { value: "linear", label: "Linear" },
          { value: "log10", label: "Log10" },
          { value: "log2", label: "Log2" },
        ]}
      />
      {value !== "linear" && leftOut > 0 && (
        <p className="text-small text-secondary">
          {leftOut} {leftOut === 1 ? "value" : "values"} at or under 0 can't be drawn on a log axis.
        </p>
      )}
    </>
  );
}
