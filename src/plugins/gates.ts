// Trust & safety gates — marketplace M3 (seq 435).
//
// Every plugin submission/install runs these gates before anything of the
// plugin's runs: (a) manifest validation, (b) a static scan for dangerous
// patterns in R and in JS/TS, (c) the plugin's own suite must pass
// (CRAN-style: it must pass its own checks), (d) the license is recorded
// verbatim, never judged (Q7 open — no allowlist, no paid handling).
//
// The scan is a tripwire, not a sandbox proof — the containment is webR
// (R cannot touch the filesystem or the network except through the host
// bridge) plus the capability boundary (capabilities.ts, enforced at the
// IPC layer by ipc-guard.ts). The scan only fails a plugin early with a
// clear message instead of letting it reach the engine.
//
// One source of truth for the R denylist: BASE_R_PATTERNS below starts
// from the exact groundwork patterns (analysis-spec.ts, 7b5d9be, verbatim)
// and EXTENDED_R_PATTERNS adds process/file-write/package-install/native
// calls. analysis-spec.ts `scanPluginRCode` delegates to
// `scanPluginRCodeExtended` here, so load-time validation and the gates
// can never drift apart.

import { validatePluginManifest, type PluginManifest, type PluginPermission } from "./manifest";

/** One static-scan hit: where it is, what pattern tripped, and why. */
export interface GateFinding {
  severity: "error" | "warning";
  file?: string;
  line?: number;
  pattern: string;
  message: string;
}

/** One gate's outcome. A gate passes when it has no error findings. */
export interface GateResult {
  id: "manifest" | "static-scan" | "own-suite" | "license";
  label: string;
  passed: boolean;
  findings: GateFinding[];
  detail: string;
}

/** The whole gate run for one plugin package. */
export interface GateReport {
  pluginId: string | null;
  pluginName: string | null;
  passed: boolean;
  /** The license string, recorded verbatim (never judged). */
  license: string | null;
  gates: GateResult[];
}

/** What a plugin's own suite returns — the shape of the hello fixture's
 *  `verifyHelloPlugin()` (examples/hello-analysis): one line per check
 *  plus an overall verdict. */
export interface OwnSuiteResult {
  ok: boolean;
  checks: string[];
}

/** The plugin's verify entry point, supplied by the caller: the fixture
 *  passes `verifyHelloPlugin`; a submitted package passes its own
 *  `verify` export (run by the M5 Isolation host, which never executes
 *  plugin code without the capability boundary in place). */
export type OwnSuiteRunner = () => Promise<OwnSuiteResult> | OwnSuiteResult;

/** What the gates run over: the parsed plugin.json plus the package's
 *  text files (name → content). */
export interface GateInput {
  manifestJson: unknown;
  files: ReadonlyMap<string, string>;
  runOwnSuite?: OwnSuiteRunner;
}

// ── R static scan ──────────────────────────────────────────────────────────
// Base: the groundwork denylist (analysis-spec.ts, verbatim patterns and
// messages). Extensions: process/file writes, package installs, and
// native-code calls — all things an R plugin must never do (packages come
// from the vendored repo via `ensurePackages`; there is no native code).

interface RPattern {
  pattern: RegExp;
  message: string;
}

const BASE_R_PATTERNS: RPattern[] = [
  { pattern: /\b(system|shell)\s*\(/, message: "must not run shell commands (system()/shell())" },
  {
    pattern: /\b(library|require)\s*\(/,
    message: "must not load packages inline (library()/require()) — declare them in requiredPackages",
  },
  { pattern: /\bsource\s*\(/, message: "must not source files (source())" },
  {
    pattern: /\b(download\.file|url|socketConnection)\s*\(/,
    message: "must not reach the network (download.file()/url()/socketConnection())",
  },
  {
    pattern: /\b(readLines|read\.csv|read\.table|scan)\s*\(/,
    message: "must not read files (readLines()/read.csv()/read.table()/scan())",
  },
  { pattern: /\b(file|list\.files|dir)\s*\(/, message: "must not touch the filesystem (file()/list.files()/dir())" },
  { pattern: /\beval\s*\(/, message: "must not evaluate generated code (eval())" },
];

const EXTENDED_R_PATTERNS: RPattern[] = [
  { pattern: /\b(system2|pipe)\s*\(/, message: "must not run shell commands (system2()/pipe())" },
  {
    pattern: /\b(unlink|file\.create|file\.remove|file\.rename|file\.copy)\s*\(/,
    message: "must not change files (unlink()/file.create()/file.remove()/file.rename()/file.copy())",
  },
  {
    pattern: /\b(write\.csv|write\.table|writeLines|saveRDS|save)\s*\(/,
    message: "must not write files (write.csv()/write.table()/save()/saveRDS())",
  },
  {
    pattern: /\b(install\.packages|install_github)\s*\(/,
    message: "must not install packages (install.packages()) — declare them in requiredPackages",
  },
  {
    pattern: /\b(dyn\.load|library\.dynam)\s*\(/,
    message: "must not call native code (dyn.load()/library.dynam()) — plugins are R + JS/TS only",
  },
  {
    // `.Call`/`.External`/`.C` start with a dot, so `\b` can never match
    // where R puts them (line start, after whitespace or an operator:
    // `x <- .Call("f")`) — the old combined `\b(...|\.Call|...)` pattern
    // silently missed every real native call (market-gates-dotcall40,
    // cycle 40). Match them only when the dot is NOT part of a longer
    // dotted name: a preceding word char or dot means the call is to a
    // function literally named e.g. `foo.Call`, not to `.Call` — that
    // case matched before via the same broken `\b` path and no longer
    // trips, deliberately. `(` may follow whitespace (`a <- .Call ("g")`).
    pattern: /(^|[^A-Za-z0-9_.])(\.Call|\.External|\.C)\s*\(/,
    message: "must not call native code (.Call()/.External()/.C()) — plugins are R + JS/TS only",
  },
  { pattern: /\bload\s*\(/, message: "must not load saved workspaces (load())" },
];

/** The full R denylist: the groundwork base plus the M3 extensions. */
export const R_DENYLIST: readonly RPattern[] = [...BASE_R_PATTERNS, ...EXTENDED_R_PATTERNS];

const lineOf = (code: string, index: number): number => code.slice(0, index).split("\n").length;

/** The forbidden-pattern findings in R code (empty: clean). Each finding
 *  names the pattern that tripped and the line it is on. */
export function scanPluginRCodeExtended(code: string, file?: string): GateFinding[] {
  const findings: GateFinding[] = [];
  for (const { pattern, message } of R_DENYLIST) {
    const match = pattern.exec(code);
    if (match) {
      findings.push({
        severity: "error",
        ...(file ? { file } : {}),
        line: lineOf(code, match.index),
        pattern: pattern.source,
        message: `Plugin R code ${message}.`,
      });
    }
  }
  return findings;
}

// ── JS/TS static scan ──────────────────────────────────────────────────────
// Plugin JS/TS is scanned as text (it is never executed by the gates).
// Network use is an error only when the manifest does not declare the
// `network` permission; when declared it is a warning — the user must
// still grant it at the enable review step (review.ts / loader.ts).

interface JsPattern {
  pattern: RegExp;
  name: string;
  message: string;
  network?: boolean;
}

const JS_PATTERNS: JsPattern[] = [
  { pattern: /\beval\s*\(/, name: "eval", message: "must not evaluate generated code (eval())" },
  {
    pattern: /\bnew\s+Function\s*\(/,
    name: "Function",
    message: "must not build functions from strings (new Function())",
  },
  {
    pattern: /require\s*\(\s*["'](node:)?child_process["']\s*\)|from\s+["'](node:)?child_process["']/,
    name: "child_process",
    message: "must not spawn processes (child_process)",
  },
  {
    pattern: /require\s*\(\s*["'](node:)?fs(\/promises)?["']\s*\)|from\s+["'](node:)?fs(\/promises)?["']/,
    name: "fs",
    message: "must not touch the filesystem directly (fs) — save and export only through Titer",
  },
  {
    pattern: /\bfetch\s*\(/,
    name: "fetch",
    message: "reaches the network (fetch())",
    network: true,
  },
  {
    pattern: /\bnew\s+XMLHttpRequest\s*\(/,
    name: "XMLHttpRequest",
    message: "reaches the network (XMLHttpRequest)",
    network: true,
  },
  {
    pattern: /\bnew\s+WebSocket\s*\(/,
    name: "WebSocket",
    message: "reaches the network (WebSocket)",
    network: true,
  },
  {
    pattern: /require\s*\(\s*["'](node:)?https?["']\s*\)|from\s+["'](node:)?https?["']/,
    name: "http",
    message: "reaches the network (node http/https)",
    network: true,
  },
  {
    pattern: /from\s+["']@tauri-apps\/api[^"']*["']|__TAURI(_INTERNALS__)?__/,
    name: "tauri",
    message: "must not call Tauri directly — plugin code reaches the app only through titer.* commands",
  },
  {
    pattern: /\bprocess\.(env|exit)\b/,
    name: "process",
    message: "must not reach the host process (process.env/process.exit())",
  },
];

/** The forbidden-pattern findings in JS/TS plugin code (empty: clean).
 *  Network findings are errors when the `network` permission is not
 *  declared, warnings when it is (the grant still happens at enable). */
export function scanPluginJsCode(
  code: string,
  file: string,
  declaredPermissions: readonly PluginPermission[],
): GateFinding[] {
  const findings: GateFinding[] = [];
  const networkDeclared = declaredPermissions.includes("network");
  for (const { pattern, name, message, network } of JS_PATTERNS) {
    const match = pattern.exec(code);
    if (!match) continue;
    if (network) {
      findings.push({
        severity: networkDeclared ? "warning" : "error",
        file,
        line: lineOf(code, match.index),
        pattern: name,
        message: networkDeclared
          ? `Plugin JS code ${message} — the manifest declares the network permission, which the user must still grant at the enable review step.`
          : `Plugin JS code ${message} — that needs the “network” permission, which this plugin does not declare.`,
      });
    } else {
      findings.push({
        severity: "error",
        file,
        line: lineOf(code, match.index),
        pattern: name,
        message: `Plugin JS code ${message}.`,
      });
    }
  }
  return findings;
}

// ── Gate run ───────────────────────────────────────────────────────────────

const gate = (id: GateResult["id"], label: string, findings: GateFinding[], detail: string): GateResult => ({
  id,
  label,
  passed: !findings.some((f) => f.severity === "error"),
  findings,
  detail,
});

/**
 * Run all four gates over a plugin package. The manifest gate reuses the
 * groundwork validation; the scan gate covers R files, R compute code in
 * plugin.json analyses, and JS/TS files; the own-suite gate runs the
 * plugin's verify entry point (a plugin with no verify entry point, no
 * checks, or failing checks fails); the license gate records the license
 * verbatim and never judges it.
 */
export async function runPluginGates(input: GateInput): Promise<GateReport> {
  const manifestResult = validatePluginManifest(input.manifestJson);
  const manifestErrors = "errors" in manifestResult ? manifestResult.errors : ([] as string[]);
  const manifest: PluginManifest | null = "manifest" in manifestResult ? manifestResult.manifest : null;

  const manifestGate = gate(
    "manifest",
    "Manifest",
    manifestErrors.map((message) => ({ severity: "error" as const, pattern: "manifest", message })),
    manifest ? `Manifest for “${manifest.name}” ${manifest.version} is valid.` : "The manifest is invalid.",
  );

  // Static scan: R files, R compute code carried in plugin.json, JS/TS.
  const scanFindings: GateFinding[] = [];
  const declared: readonly PluginPermission[] = manifest?.permissions ?? [];
  if (manifest) {
    const raw = input.manifestJson as Record<string, unknown>;
    const analyses = Array.isArray(raw.analyses) ? raw.analyses : [];
    for (const specValue of analyses) {
      const spec = specValue as Record<string, unknown>;
      const compute = spec.compute as Record<string, unknown> | undefined;
      if (compute?.kind === "r" && typeof compute.code === "string") {
        const id = typeof spec.id === "string" ? spec.id : "?";
        scanFindings.push(...scanPluginRCodeExtended(compute.code, `plugin.json › analysis “${id}” compute`));
      }
    }
  }
  for (const [name, content] of input.files) {
    if (/\.r$/i.test(name)) scanFindings.push(...scanPluginRCodeExtended(content, name));
    if (/\.(js|mjs|ts)$/i.test(name)) scanFindings.push(...scanPluginJsCode(content, name, declared));
  }
  const errorCount = scanFindings.filter((f) => f.severity === "error").length;
  const scanGate = gate(
    "static-scan",
    "Static scan",
    scanFindings,
    errorCount === 0
      ? scanFindings.length === 0
        ? "No dangerous patterns found."
        : "No blocking patterns found (warnings only — see the findings)."
      : `${errorCount} dangerous pattern${errorCount === 1 ? "" : "s"} found.`,
  );

  // Own suite: the plugin must expose a verify entry point and pass it.
  const suiteFindings: GateFinding[] = [];
  let suiteDetail: string;
  if (!input.runOwnSuite) {
    suiteFindings.push({
      severity: "error",
      pattern: "own-suite",
      message: "This plugin exposes no verify entry point — a plugin must pass its own checks before it can be listed.",
    });
    suiteDetail = "No verify entry point — the plugin's own checks were not run.";
  } else {
    try {
      const result = await input.runOwnSuite();
      if (!result.ok) {
        suiteFindings.push({
          severity: "error",
          pattern: "own-suite",
          message: `The plugin's own checks failed: ${result.checks.join(" ")}`,
        });
        suiteDetail = "The plugin's own checks failed.";
      } else if (result.checks.length === 0) {
        suiteFindings.push({
          severity: "error",
          pattern: "own-suite",
          message: "The plugin's own suite passed but ran no checks — a suite with no checks fails the gate.",
        });
        suiteDetail = "The plugin's own suite ran no checks.";
      } else {
        suiteDetail = `The plugin's own checks passed (${result.checks.length} check${result.checks.length === 1 ? "" : "s"}).`;
      }
    } catch (err) {
      suiteFindings.push({
        severity: "error",
        pattern: "own-suite",
        message: `The plugin's own checks threw: ${err instanceof Error ? err.message : String(err)}`,
      });
      suiteDetail = "The plugin's own checks threw an error.";
    }
  }
  const suiteGate = gate("own-suite", "Own suite", suiteFindings, suiteDetail);

  // License: recorded verbatim, never judged. It passes whenever the
  // manifest is valid (validation already requires a non-empty string).
  const license = manifest?.license ?? null;
  const licenseGate = gate(
    "license",
    "License",
    manifest
      ? []
      : [{ severity: "error" as const, pattern: "license", message: "No license recorded — the manifest is invalid." }],
    license === null
      ? "No license recorded."
      : `License recorded verbatim: “${license}” — Titer does not judge licenses.`,
  );

  const gates = [manifestGate, scanGate, suiteGate, licenseGate];
  return {
    pluginId: manifest?.id ?? null,
    pluginName: manifest?.name ?? null,
    passed: gates.every((g) => g.passed),
    license,
    gates,
  };
}
