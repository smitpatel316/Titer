// Plotly, loaded on the first graph shown rather than at startup. The full
// `dist-min` build includes WebGL traces (`scattergl`) for large scatter plots (volcano).
type Plotly = {
  react: (el: HTMLElement, data: unknown[], layout: object, config: object) => Promise<unknown>;
  purge: (el: HTMLElement) => void;
  toImage: (
    figure: HTMLElement | { data: unknown[]; layout: object },
    opts: { format: "png" | "jpeg" | "svg"; width: number; height: number; scale: number },
  ) => Promise<string>;
};

let plotly: Promise<Plotly> | null = null;

export const loadPlotly = () => (plotly ??= import("plotly.js-dist-min").then((m) => m.default as Plotly));

/** The per-render uid Plotly draws from `Math.random()` (`plotly.min.js`:
 *  `fullLayout._uid = randstr(...)`, then `defs-<uid>`, `topdefs-<uid>`,
 *  `clip<uid>…`, `legend<uid>`, and one `trace<uid>` class per trace) —
 *  so even two renders on the same machine differ in SVG bytes (L8
 *  §4 cause 1), and the same machine's two exports differ too.
 *
 *  A second, smaller nondeterminism rides along: Plotly's `toSVG` sets
 *  `style.background = ""` on the root `<svg>` and only then appends
 *  `viewBox`, so whether the plotted svg already carried a `viewBox`
 *  decides the root tag's attribute order — it flips run to run
 *  (`style="" viewBox="…"` vs `viewBox="…" style=""`).
 *
 *  `normalizePlotlySvg` removes both, in the EXPORTER only (the
 *  on-screen view is untouched — it never serializes): every random id
 *  becomes the fixed `uid` (default `000000`, Plotly's own 6-hex shape),
 *  and the root tag's attributes are emitted in one canonical order
 *  (alphabetical by name; attribute order has no XML semantics). The
 *  result is deterministic per export on one machine: the same graph
 *  exported twice is byte-identical in SVG. Cross-platform PNG/SVG
 *  byte-equality is still out of reach (font rasterization, L8 cause 2)
 *  — screenshot tests keep the L8 similarity threshold.
 *
 *  `uid` scopes the ids: a lone graph exports with the default, while a
 *  figure's panels each pass their own (`p0`, `p1`, …) so panels composed
 *  into one SVG never share an id — normalizing every panel to the same
 *  token would make `url(#clip…)` resolve to the first panel's clip.
 *  Pure string surgery, fail-open: an SVG whose root tag doesn't parse
 *  is returned with its ids normalized and the tag untouched. */
export function normalizePlotlySvg(svg: string, uid = "000000"): string {
  const ids = svg
    .replace(/defs-[0-9a-f]{6}/g, `defs-${uid}`)
    .replace(/topdefs-[0-9a-f]{6}/g, `topdefs-${uid}`)
    .replace(/clip[0-9a-f]{6}/g, `clip${uid}`)
    .replace(/legend[0-9a-f]{6}/g, `legend${uid}`)
    .replace(/trace[0-9a-f]{6}/g, `trace${uid}`);
  const open = ids.indexOf("<svg");
  if (open < 0) return ids;
  let i = open + 4;
  let inQuote: string | null = null;
  while (i < ids.length) {
    const ch = ids[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") inQuote = ch;
    else if (ch === ">") break;
    i++;
  }
  if (i >= ids.length) return ids;
  const attrs = [...ids.slice(open + 4, i).matchAll(/([^\s=/>]+)="([^"]*)"/g)];
  if (!attrs.length) return ids;
  attrs.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return ids.slice(0, open) + "<svg " + attrs.map((a) => `${a[1]}="${a[2]}"`).join(" ") + ">" + ids.slice(i + 1);
}
