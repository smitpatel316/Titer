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
// `\\^`, `\\_`, `\\\\` are literal. Output is idempotent: a string the
// formatter already produced (only allowlisted tags — `<sup>`, `<sub>`,
// `<br>`, `<b>`, `<i>` — and its own entities) passes through unchanged,
// while any other markup is escaped exactly once, so a second format
// pass never double-escapes and a crafted tag smuggled in beside a
// `<sup>` never renders (seq 554/555). Annotation `name`s are stable
// drag keys and are never rewritten, only their `text` is (seq 563).
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
    // Plain runs coalesce (they are pushed a character at a time), but a
    // script run never merges into the previous one: each `^` / `_` marker
    // is its own run, so `ctrl_1_a` stays two subscripts (seq 569) instead
    // of collapsing to one `ctrl<sub>1a</sub>`.
    if (cur && cur.script === script && script === "normal") cur.text += text;
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
      // non-space character (e.g. `^+`) is raised on its own. The sign
      // is ASCII `-` or Unicode minus U+2212, so `10^−6` raises `−6`
      // whole (seq 569) instead of splitting after the minus.
      const start = i + 1;
      let j = start;
      if ((label[j] === "+" || label[j] === "-" || label[j] === "−") && isAlnum(label[j + 1] ?? "")) j++;
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

// Tags this formatter itself emits, plus the safe formatting tags the
// graph builders use in their own HTML strings (`<br>` line breaks in
// tooltips/notes, `<b>`/`<i>` in the survival number-at-risk header).
// Anything else in angle brackets is untrusted markup, never a pass-through.
const FORMATTED_TAG = /^(<\/?(?:sup|sub|br|b|i)\s*\/?>)/;
// Entities this formatter emits. A raw `&` that is not one of these is
// unescaped user text, not already-formatted output.
const FORMATTED_ENTITY = /^(&(?:amp|lt|gt|#94|#95);)/;

/** True when `label` is already this formatter's output: it carries at
 *  least one formatted tag/entity, and every `<` starts an allowlisted
 *  tag and every `&` starts an allowlisted entity. Such a string passes
 *  through unchanged, so formatting a figure twice is a no-op — without
 *  the old short-circuit on `<sup>`/`<sub>`, which let a crafted
 *  `<a href='javascript:…'>x</a><sup>1</sup>` through verbatim (seq 555). */
function isAlreadyFormatted(label: string): boolean {
  let sawMarker = false;
  for (let i = 0; i < label.length; i++) {
    const ch = label[i]!;
    if (ch === "<") {
      const m = FORMATTED_TAG.exec(label.slice(i));
      if (!m) return false;
      sawMarker = true;
      i += m[1]!.length - 1;
    } else if (ch === "&") {
      const m = FORMATTED_ENTITY.exec(label.slice(i));
      if (!m) return false;
      sawMarker = true;
      i += m[1]!.length - 1;
    }
  }
  return sawMarker;
}

// Safe formatting tags, preserved verbatim when a raw label is formatted
// (seq 554): internal HTML strings such as the survival header
// `<b>Number at risk</b>` and `<br>`-joined tooltips keep rendering,
// while every other `<…>` in the same string is still escaped.
const SAFE_TAG = /<\/?(?:br|b|i)\s*\/?>/g;

/** A raw label as Plotly text: `GFP^hi` → `GFP<sup>hi</sup>`. Text
 *  runs are escaped and scripted; safe formatting tags pass through. */
function formatRawLabel(label: string): string {
  const formatText = (text: string): string =>
    labelRuns(text)
      .map((run) =>
        run.script === "super"
          ? `<sup>${escapePlotlyText(run.text)}</sup>`
          : run.script === "sub"
            ? `<sub>${escapePlotlyText(run.text)}</sub>`
            : escapePlotlyText(run.text),
      )
      .join("");
  let out = "";
  let last = 0;
  for (const m of label.matchAll(SAFE_TAG)) {
    out += formatText(label.slice(last, m.index));
    out += m[0];
    last = m.index + m[0].length;
  }
  out += formatText(label.slice(last));
  return out;
}

/** A label as Plotly text: `GFP^hi` → `GFP<sup>hi</sup>`. Already
 *  formatted text passes through unchanged, so formatting a figure
 *  twice is a no-op — and untrusted HTML is escaped exactly once,
 *  even when it carries a `<sup>`/`<sub>` tag (seq 555). */
export function formatLabelForPlotly(label: string): string {
  if (isAlreadyFormatted(label)) return label;
  return formatRawLabel(label);
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

function formatValue(value: unknown, inAnnotation = false): unknown {
  if (Array.isArray(value)) return value.map((v) => formatValue(v, inAnnotation));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // An annotation's `name` is the stable drag key into
      // graphOptions.points (seq 563) — it is never rewritten; only its
      // `text` is formatted. Trace `name`s (legend + hover) still format.
      if (inAnnotation && k === "name") {
        out[k] = v;
        continue;
      }
      // `layout.annotations` items are walked with the name-key guard on.
      if (k === "annotations" && Array.isArray(v)) {
        out[k] = v.map((item) => formatValue(item, true));
        continue;
      }
      // Only a label key's strings convert — a string anywhere else (a
      // hovertemplate, a tickformat, a colour) passes through untouched.
      out[k] = LABEL_KEYS.has(k) ? formatLabelValue(v) : formatValue(v, inAnnotation);
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
 *  and the headless builders hand the same figure to the overlays).
 *  Idempotent: running it twice changes nothing (seq 555). An annotation's
 *  `name` is its stable drag key and is left alone; only `text` formats
 *  (seq 563). */
export function formatFigureLabels<T extends { data: unknown[]; layout: object }>(figure: T): T {
  return {
    ...figure,
    data: figure.data.map((d) => formatValue(d)),
    layout: formatValue(figure.layout) as object,
  } as T;
}
