// Info sheets + info constants: the structured metadata (dates, lot numbers,
// concentrations) and free notes Prism keeps beside a project's tables, and
// the live hooks that let a constant's value flow into a graph or an analysis.
//
// A constant is a name + a string value, as Prism stores it — "2018-07-23",
// "0.5", "" — and a hook is a `{{Name}}` reference in a title, a limit or an
// analysis field. Hooks resolve live: whenever the constant or the consumer
// changes, the value is re-resolved, so an edited constant moves every graph
// and fit that uses it. A hook that can't resolve never becomes a silent
// number: titles keep the visible `{{Name}}`, and an analysis refuses to run
// with an error naming the constant.

import type { GraphOptions, InfoConstant, InfoSheetData, ProjectNode } from "../store/types";
import type { AnalysisParams, AnalysisType } from "../stats/types";

/** Prism's default constants, in both fixtures (a .pzfx `<Info>` and a
 *  .prism `info/<uid>/sheet.json` carry the same six). A new sheet starts with
 *  them, empty, so a project opened from Prism keeps its shape. */
export const DEFAULT_INFO_CONSTANT_NAMES = [
  "Experiment Date",
  "Experiment ID",
  "Notebook ID",
  "Project",
  "Experimenter",
  "Protocol",
] as const;

/** Prism caps a project at 500 info sheets. */
export const MAX_INFO_SHEETS = 500;
/** …and a sheet's constants at 500 rows. */
export const MAX_INFO_CONSTANTS = 500;

let constantSeq = 0;
/** A constant's id: unique within the session (files don't need stable ids —
 *  hooks name constants, they never point at an id). */
export function newConstantId(): string {
  return `c${Date.now().toString(36)}${(constantSeq++).toString(36)}`;
}

/** A fresh info sheet: Prism's six default constants, empty, and no notes. */
export function newInfoSheetData(): InfoSheetData {
  return {
    constants: DEFAULT_INFO_CONSTANT_NAMES.map((name) => ({ id: newConstantId(), name, value: "" })),
    notes: "",
    linkedTableId: null,
  };
}

/** The project's info sheets, in sidebar order. */
export function infoSheetsOf(nodes: Record<string, ProjectNode>, rootOrder: string[]): ProjectNode[] {
  return rootOrder.map((id) => nodes[id]).filter((n): n is ProjectNode => !!n && n.type === "info");
}

/** Every constant name the project holds, in sheet order (for hook pickers). */
export function allConstantNames(nodes: Record<string, ProjectNode>, rootOrder: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const sheet of infoSheetsOf(nodes, rootOrder)) {
    for (const c of sheet.info?.constants ?? []) {
      if (c.name.trim() && !seen.has(c.name)) {
        seen.add(c.name);
        names.push(c.name);
      }
    }
  }
  return names;
}

/** `{{Name}}` in text: the name inside, or null when the text isn't exactly one reference. */
export function constantRefName(text: string): string | null {
  const m = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(text.trim());
  return m ? m[1].trim() : null;
}

/** True when the text is exactly one `{{Name}}` reference. */
export const isConstantRef = (text: string): boolean => constantRefName(text) !== null;

/** All `{{Name}}` references in a text, in order. */
export function constantRefsIn(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) names.push(m[1].trim());
  return names;
}

/** A constant's value by name (first sheet wins, case-insensitive); undefined when no sheet has it. */
export function lookupConstant(sheets: ProjectNode[], name: string): string | undefined {
  const want = name.trim().toLowerCase();
  if (!want) return undefined;
  for (const sheet of sheets) {
    for (const c of sheet.info?.constants ?? []) {
      if (c.name.trim().toLowerCase() === want) return c.value;
    }
  }
  return undefined;
}

/** `{{Name}}` references in a title or label, replaced with the constants'
 *  values. A name no sheet has stays visible as `{{Name}}`, so an unresolved
 *  hook is seen, never silently dropped. */
export function resolveConstantText(text: string, sheets: ProjectNode[]): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, raw: string) => {
    const value = lookupConstant(sheets, raw.trim());
    return value === undefined ? whole : value;
  });
}

export type ResolvedNumber = { value: number } | { error: string };

/** A hook — a `{{Name}}` reference or a bare constant name — resolved to a
 *  number. Missing, empty or non-numeric is an error naming the constant,
 *  never a guessed number. */
export function resolveHookedNumber(ref: string, sheets: ProjectNode[]): ResolvedNumber {
  const name = constantRefName(ref) ?? ref.trim();
  if (!name) return { error: "No info constant was named." };
  const value = lookupConstant(sheets, name);
  if (value === undefined) return { error: `No info constant named “${name}”.` };
  if (value.trim() === "") return { error: `Info constant “${name}” is empty.` };
  const n = Number(value);
  if (!Number.isFinite(n)) return { error: `Info constant “${name}” is “${value}”, not a number.` };
  return { value: n };
}

/** A bound's side: a plain number ("0.5") or a constant name ("Kd") — a
 *  number wins as itself, otherwise the name is looked up. */
export function resolveBoundSide(side: string, sheets: ProjectNode[]): ResolvedNumber {
  const n = Number(side.trim());
  if (Number.isFinite(n) && side.trim() !== "") return { value: n };
  return resolveHookedNumber(side, sheets);
}

/** A graph's options with its hooks resolved: `{{Name}}` in the title and
 *  axis titles, and the hooked axis limits. An unresolvable limit falls back
 *  to the option's own number (or Auto) — the hook picker in the Format panel
 *  still shows which constant is hooked. */
export function resolveGraphOptions(options: GraphOptions, sheets: ProjectNode[]): GraphOptions {
  const next: GraphOptions = {
    ...options,
    title: resolveConstantText(options.title, sheets),
    xLabel: resolveConstantText(options.xLabel, sheets),
    yLabel: resolveConstantText(options.yLabel, sheets),
  };
  const limits: [keyof GraphOptions, keyof GraphOptions][] = [
    ["yMinConstant", "yMin"],
    ["yMaxConstant", "yMax"],
    ["xMinConstant", "xMin"],
    ["xMaxConstant", "xMax"],
  ];
  for (const [hookKey, limitKey] of limits) {
    const hook = options[hookKey];
    if (typeof hook !== "string" || hook.trim() === "") continue;
    const resolved = resolveHookedNumber(hook, sheets);
    if ("value" in resolved) (next as unknown as Record<string, unknown>)[limitKey] = resolved.value;
  }
  return next;
}

export type ResolvedParams = { params: AnalysisParams } | { error: string };

/** An analysis's params with its info-constant hooks resolved to the numbers
 *  the runner needs. A hook that can't resolve is an error naming the
 *  constant — the analysis doesn't run on a guessed value. Params without
 *  hooks pass through unchanged. */
export function resolveAnalysisParams(
  params: AnalysisParams | undefined,
  type: AnalysisType | undefined,
  sheets: ProjectNode[],
): ResolvedParams {
  if (!params || !type) return { params: params as AnalysisParams };
  const fail = (error: string): ResolvedParams => ({ error });

  if (type === "nonlinear-regression") {
    const p = params as Extract<AnalysisParams, { fixed?: unknown }>;
    const next = { ...p } as Record<string, unknown>;
    const fixedConstants = (p as { fixedConstants?: Record<string, string> }).fixedConstants;
    if (fixedConstants && Object.keys(fixedConstants).length) {
      const fixed: Record<string, number> = { ...(p.fixed as Record<string, number> | undefined) };
      for (const [term, name] of Object.entries(fixedConstants)) {
        const resolved = resolveHookedNumber(name, sheets);
        if ("error" in resolved) return fail(`Can't fix ${term}: ${resolved.error}`);
        fixed[term] = resolved.value;
      }
      next.fixed = fixed;
    }
    const boundsConstants = (p as { boundsConstants?: Record<string, [string, string]> }).boundsConstants;
    if (boundsConstants && Object.keys(boundsConstants).length) {
      const bounds: Record<string, [number, number]> = {
        ...(p.bounds as Record<string, [number, number]> | undefined),
      };
      for (const [term, sides] of Object.entries(boundsConstants)) {
        const lo = resolveBoundSide(sides[0], sheets);
        if ("error" in lo) return fail(`Can't bound ${term}: ${lo.error}`);
        const hi = resolveBoundSide(sides[1], sheets);
        if ("error" in hi) return fail(`Can't bound ${term}: ${hi.error}`);
        bounds[term] = [lo.value, hi.value];
      }
      next.bounds = bounds;
    }
    const ligand = (p as { ligandConcentrationConstant?: string }).ligandConcentrationConstant;
    if (ligand) {
      const resolved = resolveHookedNumber(ligand, sheets);
      if ("error" in resolved) return fail(`Can't read [L]: ${resolved.error}`);
      next.ligandConcentration = resolved.value;
    }
    const kd = (p as { ligandKdConstant?: string }).ligandKdConstant;
    if (kd) {
      const resolved = resolveHookedNumber(kd, sheets);
      if ("error" in resolved) return fail(`Can't read Kd: ${resolved.error}`);
      next.ligandKd = resolved.value;
    }
    return { params: next as AnalysisParams };
  }

  if (type === "remove-baseline") {
    const p = params as { constantHook?: string };
    if (!p.constantHook) return { params };
    const resolved = resolveHookedNumber(p.constantHook, sheets);
    if ("error" in resolved) return fail(`Can't read the baseline constant: ${resolved.error}`);
    return { params: { ...params, constant: resolved.value } as AnalysisParams };
  }

  if (type === "normalize") {
    const p = params as { constantHook?: string; zeroConstantHook?: string; hundredConstantHook?: string };
    const next = { ...params } as Record<string, unknown>;
    if (p.constantHook) {
      const resolved = resolveHookedNumber(p.constantHook, sheets);
      if ("error" in resolved) return fail(`Can't read the 100% constant: ${resolved.error}`);
      next.constant = resolved.value;
    }
    if (p.zeroConstantHook) {
      const resolved = resolveHookedNumber(p.zeroConstantHook, sheets);
      if ("error" in resolved) return fail(`Can't read the 0% constant: ${resolved.error}`);
      next.zeroConstant = resolved.value;
    }
    if (p.hundredConstantHook) {
      const resolved = resolveHookedNumber(p.hundredConstantHook, sheets);
      if ("error" in resolved) return fail(`Can't read the 100% constant: ${resolved.error}`);
      next.hundredConstant = resolved.value;
    }
    return { params: next as AnalysisParams };
  }

  return { params };
}

/** A constant as a file or an import holds it, forgivingly: a name and a
 *  value, both strings; anything else is left out. */
export function readInfoConstants(raw: unknown): InfoConstant[] {
  if (!Array.isArray(raw)) return [];
  const kept: InfoConstant[] = [];
  for (const entry of raw.slice(0, MAX_INFO_CONSTANTS)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { name, value } = entry as { name?: unknown; value?: unknown };
    if (typeof name !== "string" || name.trim() === "") continue;
    kept.push({
      id: typeof (entry as { id?: unknown }).id === "string" ? (entry as { id: string }).id : newConstantId(),
      name,
      value: typeof value === "string" ? value : value === undefined || value === null ? "" : String(value),
    });
  }
  return kept;
}
