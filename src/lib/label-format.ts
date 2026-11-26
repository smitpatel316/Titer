// Superscript (^) and subscript (_) in labels, like GraphPad Prism (seq 548).
// One shared formatter for every surface that shows a label — the table
// headers (React), the Plotly figures (the UI, and PNG/JPEG/SVG/TIFF/BMP
// through Plotly's own <sup>/<sub> support, since the exports re-draw the
// live figure), and the vector PDF/EPS export (which reads the <sup> back
// out of the SVG Plotly draws — see `textRuns` in vector-export.ts).
//
// Stored labels stay literal: "GFP^hi" is stored as typed, and only the
// rendering converts it — so a .prism round-trip keeps the caret, exactly
// as Prism stores it. Syntax: `^{...}` / `_{...}` super/subscripts the
// braced group; a bare `^` / `_` super/subscripts the next word piece —
// an optional leading +/−, then a run of letters or a run of digits
// (a class change ends the run), or any other single non-space character.
// That one rule renders every case the same way: `GFP^hi` raises `hi`,
// `H_2O` lowers just `2`, `10^-6` raises `-6`, `Ca^{2+}` raises `2+`.
// `\\^`, `\\_`, `\\\\` are literal. A label that already contains
// <sup>/<sub> markup (a figure formatted twice — the build, overlay and
// draw layers each format) passes through unchanged, and literal
// carets/underscores are emitted as numeric entities (which Plotly
// decodes), so formatting is idempotent.
import { createElement, type ReactNode } from "react";

export type ScriptKind = "normal" | "super" | "sub";

/** One run of a parsed label: plain text, or a super/subscript stretch. */
export interface LabelRun {
  text: string;
  script: ScriptKind;
}

/** Split a stored label into plain / super / subscript runs. An unclosed
 *  `^{`, a trailing `^`/`_`, or a `^`/`_` before whitespace is literal —
 *  a label is never dropped or mangled for a markup typo. */
const isAlnum = (ch: string): boolean =>
  (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");
const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";

export function labelRuns(label: string): LabelRun[] {
  const runs: LabelRun[] = [];
  let cur: LabelRun | null = null;
  const push = (text: string, script: ScriptKind) => {
    if (!text) return;
    if (cur && cur.script === script) cur.text += text;
    else {
      cur = { text, script };
      runs.push(cur);
    }
  };
  let i = 0;
  while (i < label.length) {
    const ch = label[i]!;
    if (ch === "\\" && i + 1 < label.length && (label[i + 1] === "^" || label[i + 1] === "_" || label[i + 1] === "\\")) {
      push(label[i + 1]!, "normal");
      i += 2;
      continue;
    }
    if (ch === "^" || ch === "_") {
      const script: ScriptKind = ch === "^" ? "super" : "sub";
      const next = label[i + 1];
      if (next === "{") {
        const close = label.indexOf("}", i + 2);
        if (close > i + 2) {
          push(label.slice(i + 2, close), script);
          i = close + 1;
          continue;
        }
        push(ch, "normal");
        i++;
        continue;
      }
      // A bare marker takes the next word piece: an optional leading
      // sign, then a run of letters or a run of digits — so `GFP^hi`
      // raises `hi` while `H_2O` lowers just `2`. Any other single
      // non-space character (e.g. `^+`) is raised on its own.
      const start = i + 1;
      let j = start;
      if ((label[j] === "+" || label[j] === "-") && isAlnum(label[j + 1] ?? "")) j++;
      if (isAlnum(label[j] ?? "")) {
        const digit = isDigit(label[j]!);
        let k = j;
        while (k < label.length && isAlnum(label[k]!) && isDigit(label[k]!) === digit) k++;
        push(label.slice(start, k), script);
        i = k;
        continue;
      }
      if (next !== undefined && next !== " " && next !== "\t" && next !== "\n") {
        push(next, script);
        i += 2;
        continue;
      }
      push(ch, "normal");
      i++;
      continue;
    }
    push(ch, "normal");
    i++;
  }
  return runs;
}

/** Plain text as Plotly text: HTML-escaped, with literal carets and
 *  underscores as numeric entities (Plotly decodes them) so a second
 *  format pass cannot mistake them for markup. */
const escapePlotlyText = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\^/g, "&#94;")
    .replace(/_/g, "&#95;");

/** A label as Plotly text: `GFP^hi` → `GFP<sup>hi</sup>`. Already
 *  formatted text (it contains a <sup> or <sub> tag) passes through
 *  unchanged, so formatting a figure twice is a no-op. */
export function formatLabelForPlotly(label: string): string {
  if (label.includes("<sup>") || label.includes("<sub>")) return label;
  return labelRuns(label)
    .map((run) =>
      run.script === "super"
        ? `<sup>${escapePlotlyText(run.text)}</sup>`
        : run.script === "sub"
          ? `<sub>${escapePlotlyText(run.text)}</sub>`
          : escapePlotlyText(run.text),
    )
    .join("");
}

/** A label as React nodes: `GFP^hi` → `GFP<sup>hi</sup>`, for the table
 *  headers (grid.tsx). The rename editor keeps the raw text — only the
 *  displayed header is formatted. */
export function formatLabelNodes(label: string): ReactNode[] {
  return labelRuns(label).map((run, i) =>
    run.script === "super"
      ? createElement("sup", { key: i }, run.text)
      : run.script === "sub"
        ? createElement("sub", { key: i }, run.text)
        : run.text,
  );
}

// ── Whole-figure formatting ─────────────────────────────────────────────
// Plotly renders <sup>/<sub> in every label-bearing string, so the figure
// is formatted by walking it and converting those strings — the same
// conversion everywhere, so a category value and the ticktext /
// categoryarray naming it can never disagree (a mismatch would un-match
// the category and drop the tick).
//
// Only label-bearing keys are converted: `name` (legend + hover), `text`
// and `hovertext` (point labels), `labels` (pie slices), `ticktext`,
// and the category values themselves (`x`/`y`/`z`, `categoryarray`).
// Deliberately NOT converted: `hovertemplate` / `texttemplate` (Plotly
// format strings — `%{x}` interpolates the converted value at draw time),
// `tickformat` (a d3 format, where `^` means centre-align), `ticksuffix` /
// `tickprefix`, and every numeric field. A string under any other key is
// left alone, so a future field cannot be silently rewritten.

const LABEL_KEYS = new Set(["name", "text", "hovertext", "labels", "ticktext", "x", "y", "z", "categoryarray"]);

function formatValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => formatValue(v));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Only a label key's strings convert — a string anywhere else (a
      // hovertemplate, a tickformat, a colour) passes through untouched.
      out[k] = LABEL_KEYS.has(k) ? formatLabelValue(v) : formatValue(v);
    }
    return out;
  }
  return value;
}

/** A label-keyed value: strings convert, arrays recurse (a `text` can be
 *  a 2-D array), anything else falls back to the structural walk. */
function formatLabelValue(value: unknown): unknown {
  if (typeof value === "string") return formatLabelForPlotly(value);
  if (Array.isArray(value))
    return value.map((item) => (typeof item === "string" ? formatLabelForPlotly(item) : formatLabelValue(item)));
  return formatValue(value);
}

/** A Plotly figure with every label formatted — a new figure; the input is
 *  not mutated (the graph view keeps the raw figure for its selection keys,
 *  and the headless builders hand the same figure to the overlays). */
export function formatFigureLabels<T extends { data: unknown[]; layout: object }>(figure: T): T {
  return {
    ...figure,
    data: figure.data.map((d) => formatValue(d)),
    layout: formatValue(figure.layout) as object,
  } as T;
}
