// WebR engine — R compiled to WASM, running in a Web Worker so the UI never
// blocks. The app has ONE: it lives in a hidden window (engine.ts), and project
// windows send it their R code (`connectR`). Tests and `npm run web` run R here.
// The WebR library is loaded only when R starts, so project windows never carry it.
// R packages (plan 00): base R alone cannot run Cox, ROC, mixed-effects,
// Anderson–Darling, Grubbs, Deming or Dunnett. `ensurePackages` below is the
// one way analyses get a package: it installs the named packages from the
// bundled, version-pinned repo (see scripts/build-webr-repo.sh) into this
// engine and verifies each one loads. No analysis calls `library()` inline —
// analyses use `pkg::fn` after `ensurePackages`, or `runAnalysis` ensures
// the analysis's `requiredPackages` first (src/stats/index.ts).
import type { WebR } from "webr";

/** An R result: a named numeric vector, non-finite values as `null`. */
export type RVector = Record<string, number | null>;

let engine: Promise<WebR> | null = null;
/** The booted R, while one is live in this window — what `interruptR` talks to. */
let liveWebR: WebR | null = null;

/** The R engine's boot state, for the UI: a failed boot used to be swallowed
 *  (`startR().catch(() => {})` in the engine window) with nothing to show
 *  for it until an analysis ran and failed (CC-m7). `booting` until the
 *  first boot settles — and again after `resetR()` abandons the engine, so
 *  the next evaluation's re-boot starts from there; `failed` carries the
 *  boot error; `ready` once an R is live. The engine window publishes
 *  changes to project windows (see `publishEngineBootStatus`); tests and
 *  `npm run web` read this same state in this window. */
export type EngineBootStatus = { state: "booting" | "ready" | "failed"; error?: string };
let bootStatus: EngineBootStatus = { state: "booting" };
const bootStatusListeners = new Set<(status: EngineBootStatus) => void>();
export function getEngineBootStatus(): EngineBootStatus {
  return bootStatus;
}
export function onEngineBootStatus(handler: (status: EngineBootStatus) => void): () => void {
  bootStatusListeners.add(handler);
  return () => {
    bootStatusListeners.delete(handler);
  };
}
function setEngineBootStatus(status: EngineBootStatus): void {
  bootStatus = status;
  for (const listener of bootStatusListeners) listener(status);
}
let remote: ((code: string) => Promise<RVector>) | null = null;
/** Stops the in-flight remote evaluation (the app's engine window), if one is wired. */
let remoteCancel: (() => Promise<void>) | null = null;

/** The baseUrl the last engine that booted successfully used — the re-boot
 *  location. A fresh boot after `resetR()` (or a failed boot) used to fall
 *  back to the app default "/webr/", which only exists in the Tauri
 *  webview: in tests and `npm run web` the worker file is not there, so
 *  the re-boot died with `Cannot find module '/webr/webr-worker.js'` and
 *  killed the process (R3-MAC-PACKAGES: R3-26 threads the caller's short
 *  timeout into the install eval, so P-12's 2 s timeout fires the eval
 *  watchdog, the grace expires, `resetR()` abandons the engine, and the
 *  next bare `startR()` re-booted from "/webr/"). The remembered URL is
 *  only updated by a boot that actually succeeded — a failed boot (e.g.
 *  the hung-boot probe's stub worker) must not overwrite the last good
 *  location — and `resetR()` deliberately leaves it alone: the engine is
 *  gone, the location is not. */
let bootBaseUrl: string | null = null;

/** Start (or reuse) the R runtime. A failed boot is retried on the next call.
 *  `baseUrl` locates the R files: served by the app, or a folder when run by the tests.
 *  A bare call re-boots from where the engine last booted successfully (see
 *  `bootBaseUrl` above); an explicit `baseUrl` always wins for that boot.
 *  The boot races its watchdog (`BOOT_TIMEOUT_MS`): a hung WASM load used to
 *  leave `engine` pending forever, stranding every later evaluation — and, in
 *  `runAnalysis`, the cached run itself (M15) — because the boot is awaited
 *  before the evaluation watchdog starts. A timed-out boot is abandoned (the
 *  WASM load cannot be cancelled) and the memo reset, so the next call boots
 *  fresh; the caller gets a timeout error, which `runAnalysis` surfaces and
 *  evicts from its cache, so a retry works. */
export function startR(baseUrl?: string, opts?: { timeoutMs?: number }): Promise<WebR> {
  const timeoutMs = opts?.timeoutMs ?? BOOT_TIMEOUT_MS;
  const url = baseUrl ?? bootBaseUrl ?? "/webr/";
  return (engine ??= (async () => {
    setEngineBootStatus({ state: "booting" });
    const { WebR } = await import("webr");
    const webR = new WebR({ baseUrl: url });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        webR.init(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new BootTimeoutError(
                  `R took longer than ${formatBudget(timeoutMs)} to start and was stopped. Try running the analysis again.`,
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    // The boot succeeded: this is the location a later bare re-boot reuses.
    bootBaseUrl = url;
    liveWebR = webR;
    setEngineBootStatus({ state: "ready" });
    return webR;
  })().catch((err) => {
    engine = null;
    liveWebR = null;
    setEngineBootStatus({ state: "failed", error: err instanceof Error ? err.message : String(err) });
    throw err;
  }));
}

/** From now on, `evalNamedVector` hands its code to `evaluate` (the app's engine).
 *  `cancel` stops the in-flight remote evaluation (the engine window's R). */
export function connectR(evaluate: (code: string) => Promise<RVector>, cancel?: () => Promise<void>) {
  remote = evaluate;
  remoteCancel = cancel ?? null;
}

// ── Watchdog: no R evaluation runs forever ────────────────────────────────
// A hung R call used to strand the analysis on "Running…" forever, the only
// recovery a restart. Every evaluation below now races its watchdog budget:
// on a timeout (or a cancel) R is interrupted, and if the interrupt does not
// free it within the grace, the engine is abandoned for a fresh one.

/** How long one R calculation may run before the watchdog stops it. Five
 *  minutes: every analysis in the suite finishes in seconds, and the slowest
 *  measured provisioning batch (a 21-package install) takes ~71 s — a single
 *  calculation past this is hung, not slow. A caller with a legitimately
 *  longer calculation passes `timeoutMs`. */
export const EVAL_TIMEOUT_MS = 300_000;
/** How long the watchdog waits for the interrupt to free R before giving up
 *  on the engine and restarting it. */
export const INTERRUPT_GRACE_MS = 5_000;

/** The watchdog stopped a calculation that ran past its budget. */
export class EvalTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalTimeoutError";
  }
}

/** How long an R boot may take before it is treated as hung. Five minutes,
 *  like `EVAL_TIMEOUT_MS`: a cold boot measured 29.6 s on this host
 *  (2026-11-12, loaded box) — a boot past this is hung, not slow. A caller
 *  that must wait longer passes `timeoutMs` to `startR`. */
export const BOOT_TIMEOUT_MS = 300_000;

/** The watchdog stopped an R boot that ran past its budget. */
export class BootTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootTimeoutError";
  }
}

/** The user cancelled a running calculation. */
export class EvalCancelledError extends Error {
  constructor(message = "The calculation was cancelled.") {
    super(message);
    this.name = "EvalCancelledError";
  }
}

/** Per-evaluation options: a watchdog budget, and a signal that cancels it. */
export interface EvalOptions {
  /** Watchdog budget in ms (default `EVAL_TIMEOUT_MS`). */
  timeoutMs?: number;
  /** Grace after the interrupt before the engine is restarted (default `INTERRUPT_GRACE_MS`). */
  graceMs?: number;
  /** Aborting this cancels the evaluation. */
  signal?: AbortSignal;
}

/**
 * Interrupt the R running in this window's engine, if one is live. Best
 * effort, never throws: webR's `interrupt()` only works on its
 * SharedArrayBuffer channel — on the PostMessage fallback (a Tauri webview
 * without cross-origin isolation) it logs and does nothing, which is why a
 * stuck evaluation escalates to restarting the engine (see `onEngineStuck`).
 */
export function interruptR(): void {
  try {
    liveWebR?.interrupt();
  } catch {
    // No live R, or the channel cannot be interrupted — the watchdog's
    // escalation below is the recovery.
  }
}

/** Drop the cached engine, so the next evaluation boots a fresh R. The
 *  wedged worker is abandoned with it; in the app the engine window reloads
 *  so it dies too (see `onEngineStuck`).
 *
 *  A fresh engine has an empty VFS, so every package state is void with
 *  the old one (R3-02): installed packages are cleared back to
 *  `not-loaded`, or the next `ensurePackages` would see them `ready` and
 *  skip the install — and the analysis would fail with `there is no
 *  package called '…'` in the fresh engine. An install still in flight is
 *  cancelled (its late completion must write no states for an engine that
 *  no longer exists) and its packages are marked `failed`, so a caller
 *  waiting on that batch gets a provisioning error it can retry from,
 *  instead of a silent success followed by the same `no package` failure
 *  when the analysis runs. The remembered boot location (`bootBaseUrl`)
 *  is deliberately left alone: the engine is gone, the location is not,
 *  and the next bare `startR()` must re-boot from it. */
export function resetR(): void {
  engine = null;
  liveWebR = null;
  // No live engine any more: the next evaluation boots a fresh R, so the
  // boot state goes back to pending (CC-m7).
  setEngineBootStatus({ state: "booting" });
  const installing = [...inflight.keys()];
  for (const ticket of inflight.values()) {
    ticket.cancel.current = true;
    ticket.releaseGate();
  }
  inflight.clear();
  states.clear();
  // The claims die with the engine: a fresh engine has empty
  // `.helix_install_claims` / `.helix_install_claim_tokens`, so tokens
  // recorded against the old engine could never match anything again —
  // and a retry must mint fresh ones, never reclaim a dead claim.
  claimTokens.clear();
  for (const name of installing) {
    states.set(name, {
      status: "failed",
      error: `The R engine was restarted while “${name}” was installing — try running the analysis again.`,
      kind: "install-failed",
    });
  }
}

/** Called when an evaluation stays stuck after the interrupt — the engine
 *  needs restarting, not another interrupt. The engine window registers a
 *  handler that drops the shell's waiting requests and reloads itself; tests
 *  and `npm run web` register none, and the next evaluation simply boots a
 *  fresh R (`resetR` above). */
let engineStuckHandler: (() => void) | null = null;
export function onEngineStuck(handler: (() => void) | null): void {
  engineStuckHandler = handler;
}

/** Every evaluation in flight in this window, each with its own abort. */
const liveEvals = new Set<{ controller: AbortController }>();

/** Cancel every evaluation in flight in this window. The app's one R serves
 *  every window, but a cancel only stops this window's own work (FL-F14):
 *  the shell drops only this window's waiting requests and the engine
 *  dequeues them; R is interrupted only if the evaluation now running is
 *  one of this window's — a queued check's cancel no longer kills another
 *  window's in-flight install. A cancelled run is not cached, so asking
 *  again retries it. */
export function cancelActiveEvals(): void {
  for (const { controller } of liveEvals) controller.abort();
}

function formatBudget(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Race an R evaluation against its watchdog budget and an abort signal. On
 * a timeout or a cancel, R is interrupted (`onTrigger` — `interruptR` for a
 * local engine, the remote cancel for the app's engine window) and the
 * evaluation gets `graceMs` to die; a calculation that outlives the grace
 * means the interrupt did not free R, so the engine is abandoned (`resetR`)
 * and the registered stuck-engine recovery runs. The caller's error is a
 * timeout/cancel error either way — never a raw R interrupt, and never a
 * hang. The underlying evaluation promise may stay pending forever (as with
 * `ensurePackages`' install race); it is abandoned with the engine.
 */
async function withEvalWatchdog<T>(
  task: Promise<T>,
  opts: { timeoutMs: number; graceMs: number; signal?: AbortSignal; onTrigger: () => void },
): Promise<T> {
  const entry = { controller: new AbortController() };
  liveEvals.add(entry);
  const onExternalAbort = () => entry.controller.abort();
  opts.signal?.addEventListener("abort", onExternalAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let triggered: "timeout" | "cancelled" | null = null;
  let taskSettled = false;
  let error: Error = new EvalTimeoutError("");
  const guarded = task.then(
    (value) => {
      taskSettled = true;
      return value;
    },
    (err) => {
      taskSettled = true;
      throw err instanceof Error ? err : new Error(String(err));
    },
  );

  const cleanup = () => {
    clearTimeout(timer);
    clearTimeout(graceTimer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
    liveEvals.delete(entry);
  };

  try {
    return await new Promise<T>((resolve, reject) => {
      let done = false;
      const settle = (fn: () => void) => {
        if (done) return;
        done = true;
        fn();
      };
      guarded.then(
        (value) => settle(() => (triggered ? reject(error) : resolve(value))),
        (err) => settle(() => reject(triggered ? error : err)),
      );
      const trigger = (kind: "timeout" | "cancelled") => {
        if (triggered) return;
        triggered = kind;
        error =
          kind === "timeout"
            ? new EvalTimeoutError(
                `The calculation took longer than ${formatBudget(opts.timeoutMs)} and was stopped. Try running it again.`,
              )
            : new EvalCancelledError();
        opts.onTrigger();
        graceTimer = setTimeout(() => {
          if (!taskSettled) {
            // The interrupt did not free R: abandon this engine so the next
            // calculation boots a fresh one.
            resetR();
            engineStuckHandler?.();
            if (kind === "timeout") {
              error = new EvalTimeoutError(
                `The calculation took longer than ${formatBudget(opts.timeoutMs)} and was stopped — the R engine was restarted. Try running it again.`,
              );
            }
          }
          settle(() => reject(error));
        }, opts.graceMs);
      };
      timer = setTimeout(() => trigger("timeout"), opts.timeoutMs);
      entry.controller.signal.addEventListener("abort", () => trigger("cancelled"), { once: true });
    });
  } finally {
    cleanup();
  }
}

/**
 * The R string literal holding `code` as a single braced expression.
 * First-party code is built by joining fragments with `;`, and a
 * missing fragment leaves a double separator (`;;` — the RM-ANOVA head
 * is `${a};${gg or ""};${ec}`). At the top level of `parse(text=…)` a
 * `;;` is a parse error (`unexpected ';'`), while inside braces it is
 * an empty statement, exactly as the old `local({…})` form parsed it —
 * so the text is braced. The braces also close on their own line, so a
 * trailing `#` comment in the code cannot swallow the closing brace.
 */
function bracedCodeLiteral(code: string): string {
  return JSON.stringify(`{\n${code}\n}`);
}

/**
 * R source that evaluates `code` inside a fresh child environment of the
 * global environment — the replacement for the old `local()` template
 * interpolation. Two properties matter, and both are security properties
 * (Round 2 Issue 6, seq 470):
 *
 * 1. The code travels as DATA, not as code: it is embedded as a
 *    JSON-escaped string literal and parsed inside R (`parse(text=…)`).
 *    A `})` in the code can no longer close the surrounding expression
 *    and inject further R — the old form interpolated the code straight
 *    into the `local({…})` template, so plugin code could break out of
 *    the block entirely.
 * 2. The code runs in a FRESH environment (`new.env(parent=globalenv())`),
 *    so bindings it creates never land in the shared evaluation
 *    environment, while attached packages stay visible through the
 *    global environment's parent chain — the same name resolution
 *    `local()` gave, without sharing the environment itself.
 */
function freshEnvEvalExpression(code: string): string {
  return `eval(parse(text=${bracedCodeLiteral(code)}), envir=new.env(parent=globalenv()))`;
}

/**
 * R source that evaluates PLUGIN `code` inside its own fresh environment
 * with the shared global environment shadowed: `.GlobalEnv` inside the
 * plugin environment is bound to a throwaway empty environment (and the
 * binding is locked), so plugin code that assigns into `.GlobalEnv` —
 * the shared-engine escape — writes into the void instead of the
 * engine's global environment, and the binding itself cannot be
 * rebound. The plugin's own bindings still land in its private
 * environment, and attached packages stay visible through the parent
 * chain (Round 2 Issue 6, seq 470). The static gates (gates.ts) reject
 * `.GlobalEnv` / `globalenv()` / `parent.env()` in plugin code at
 * install time; this is the runtime backstop for code that reaches the
 * engine anyway.
 */
function pluginEvalExpression(code: string): string {
  return (
    `local({` +
    ` .__titer_plugin_env__ <- new.env(parent=globalenv());` +
    ` assign(".GlobalEnv", new.env(parent=emptyenv()), envir=.__titer_plugin_env__);` +
    ` lockBinding(".GlobalEnv", .__titer_plugin_env__);` +
    ` eval(parse(text=${bracedCodeLiteral(code)}), envir=.__titer_plugin_env__)` +
    ` })`
  );
}

/**
 * Evaluate R code that returns an unnamed numeric vector, marshalled to a JS
 * array in order. The vector twin of `evalNamedVector` — what lets an
 * analysis return per-point results (fitted values, a dense curve).
 * Non-finite entries come back as NaN, so positions (and lengths) are
 * preserved. In a project window the code runs in the engine window, which
 * only serves named vectors: the entries are named v1..vn in R and read
 * back in that order.
 */
export async function evalNumericVector(code: string, opts?: EvalOptions): Promise<number[]> {
  const timeoutMs = opts?.timeoutMs ?? EVAL_TIMEOUT_MS;
  const graceMs = opts?.graceMs ?? INTERRUPT_GRACE_MS;
  if (remote) {
    const named = await withEvalWatchdog(
      remote(
        `v<-eval(parse(text=${bracedCodeLiteral(code)}), envir=new.env(parent=globalenv()));names(v)<-paste0("v",seq_along(v));v`,
      ),
      {
        timeoutMs,
        graceMs,
        signal: opts?.signal,
        onTrigger: () => {
          void remoteCancel?.();
        },
      },
    );
    return Object.keys(named)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      .map((k) => named[k] ?? NaN);
  }
  const webR = await startR();
  const shelter = await new webR.Shelter();
  try {
    const values = await withEvalWatchdog(
      (async () => {
        const result = await shelter.evalR(freshEnvEvalExpression(code)).catch((err: unknown) => {
          // R says "Error in `call`: reason". The call is our generated code: keep the reason.
          throw new Error(String(err instanceof Error ? err.message : err).replace(/^Error in `[^`]*`\s*:\s*/, ""));
        });
        const { values } = (await result.toJs()) as { values: number[] };
        return values;
      })(),
      { timeoutMs, graceMs, signal: opts?.signal, onTrigger: interruptR },
    );
    return values.map((v) => (Number.isFinite(v) ? v : NaN));
  } finally {
    shelter.purge();
  }
}

/**
 * Evaluate R code that returns a named numeric vector, marshalled to a plain
 * `{ name: value }` map. The single primitive every analysis builds on. The
 * code runs in a fresh environment (see `freshEnvEvalExpression`), so
 * analyses can never read each other's variables — or each other's
 * bindings in the shared engine.
 */
export async function evalNamedVector(code: string, opts?: EvalOptions): Promise<RVector> {
  return evalNamedVectorIn(code, opts, false);
}

/**
 * Evaluate PLUGIN R code that returns a named numeric vector — the only
 * path plugin compute code may take into the shared engine (registry.ts).
 * Plugin code runs in its own environment with `.GlobalEnv` shadowed
 * (see `pluginEvalExpression`): it can neither read nor write the
 * engine's global environment, and it cannot break out of the evaluation
 * by closing a brace — the code travels as a string literal, never
 * interpolated as R source (Round 2 Issue 6, seq 470).
 */
export async function evalPluginNamedVector(code: string, opts?: EvalOptions): Promise<RVector> {
  return evalNamedVectorIn(code, opts, true);
}

async function evalNamedVectorIn(code: string, opts: EvalOptions | undefined, plugin: boolean): Promise<RVector> {
  const timeoutMs = opts?.timeoutMs ?? EVAL_TIMEOUT_MS;
  const graceMs = opts?.graceMs ?? INTERRUPT_GRACE_MS;
  const wrapped = plugin ? pluginEvalExpression(code) : freshEnvEvalExpression(code);
  if (remote) {
    return withEvalWatchdog(remote(wrapped), {
      timeoutMs,
      graceMs,
      signal: opts?.signal,
      onTrigger: () => {
        void remoteCancel?.();
      },
    });
  }
  const webR = await startR();
  const shelter = await new webR.Shelter();
  try {
    const { names, values } = await withEvalWatchdog(
      (async () => {
        const result = await shelter.evalR(wrapped).catch((err: unknown) => {
          // R says "Error in `call`: reason". The call is our generated code: keep the reason.
          throw new Error(String(err instanceof Error ? err.message : err).replace(/^Error in `[^`]*`\s*:\s*/, ""));
        });
        return (await result.toJs()) as { names: string[] | null; values: number[] };
      })(),
      { timeoutMs, graceMs, signal: opts?.signal, onTrigger: interruptR },
    );
    const out: RVector = {};
    (names ?? []).forEach((name, i) => {
      out[name] = Number.isFinite(values[i]) ? values[i] : null;
    });
    return out;
  } finally {
    shelter.purge();
  }
}

// ── R package provisioning (plan 00) ────────────────────────────────────

/** The webR release this repo is built against (package.json pins it exactly). */
export const WEBR_VERSION = "0.6.0";
/** The R release webR 0.6.0 ships (verified: `R.version.string`). */
export const R_VERSION = "4.6.0";
/** The repo layout's major.minor dir (repo.r-wasm.org uses 4.6, not 4.6.0). */
export const R_MAJOR_MINOR = "4.6";
/** The CDN repo root webR installs from when no bundled repo is configured. */
export const CDN_REPO_URL = "https://repo.r-wasm.org";
/** The bundled repo, served from the app bundle (vite copies webr-repo/). */
export const BUNDLED_REPO_URL = "/webr-repo";

/** One pinned package: CRAN version (as in PACKAGES), CRAN license, and
 *  which plans need it. Versions are pinned, never "latest": a parity result
 *  proven against survival 3.8-12 is not proven against 3.8-13. */
export interface PackageEntry {
  name: string;
  /** CRAN form, e.g. "3.8-12" (R reports it dotted: "3.8.12"). */
  version: string;
  license: string;
  /** Dependent plan numbers, e.g. ["10", "27"]. */
  plans: string[];
  /** What the dependent analyses use it for. */
  uses: string;
}

export const PACKAGE_REGISTRY: PackageEntry[] = [
  { name: "survival", version: "3.8-12", license: "LGPL (>= 2)", plans: ["10", "27"], uses: "Cox regression (coxph), log-rank (survdiff), Kaplan-Meier (survfit)" },
  { name: "pROC", version: "1.19.1", license: "GPL (>= 3)", plans: ["05"], uses: "ROC curves (roc, auc, ci.auc, coords)" },
  { name: "lme4", version: "2.0-6", license: "GPL (>= 2)", plans: ["14", "20"], uses: "Mixed-effects models (lmer); nested-test v2" },
  { name: "lmerTest", version: "3.2-1", license: "GPL (>= 2)", plans: ["20"], uses: "Satterthwaite p-values for lmer fits (lmer wrapper)" },
  { name: "pbkrtest", version: "0.5.5", license: "GPL (>= 2)", plans: ["20"], uses: "Kenward-Roger denominator DF for lmer fits (vcovAdj, get_Lb_ddf)" },
  { name: "multcomp", version: "1.4-32", license: "GPL-2", plans: ["25"], uses: "Dunnett multiple comparisons (glht)" },
  { name: "mvtnorm", version: "1.2-4", license: "GPL-2", plans: ["25"], uses: "Multivariate t/normal probabilities under multcomp::glht" },
  { name: "nortest", version: "1.0-4", license: "GPL (>= 2)", plans: ["23"], uses: "Anderson–Darling (ad.test); NOT D'Agostino–Pearson — nortest::pearson.test is a binned chi-square goodness-of-fit test, not the omnibus K2 (plan 23 implements K2 in TypeScript)" },
  { name: "outliers", version: "0.15", license: "GPL (>= 2)", plans: ["24"], uses: "Grubbs' outlier test (grubbs.test)" },
  { name: "deming", version: "1.4-1", license: "LGPL (>= 2)", plans: ["13"], uses: "Deming regression (deming); cross-check for the closed-form path" },
  { name: "MethComp", version: "1.30.2", license: "GPL (>= 2)", plans: ["13"], uses: "Deming regression alternative (Deming)" },
  { name: "nlme", version: "3.1-171", license: "GPL (>= 2)", plans: ["14", "20"], uses: "Mixed-effects alternative (lme); Deming via MethComp's dependency" },
];

const registryByName = new Map(PACKAGE_REGISTRY.map((p) => [p.name, p]));

/** A package's install state in this engine's lifetime. Installs are NOT
 *  persisted: webR mounts packages into the in-memory filesystem, so an app
 *  restart re-installs lazily, per analysis — never all at startup. */
export type PackageStatus = "not-loaded" | "loading" | "ready" | "failed";

export type PackageErrorKind =
  | "not-in-registry"
  | "not-in-repo"
  | "network"
  | "install-failed"
  | "load-failed"
  | "timeout";

/** A typed provisioning failure: `kind` decides the user-facing message and
 *  whether a retry can help; `message` is the plain-language detail. */
export class PackageError extends Error {
  constructor(
    readonly kind: PackageErrorKind,
    readonly packageName: string,
    message: string,
  ) {
    super(message);
    this.name = "PackageError";
  }
}

interface PackageState {
  status: PackageStatus;
  /** Last failure's message, while `failed`. */
  error?: string;
  /** Last failure's kind, while `failed`. */
  kind?: PackageErrorKind;
  /** Where the installed copy came from, while `ready`. */
  source?: "bundled" | "cdn";
}

const states = new Map<string, PackageState>();
/** One in-flight install batch, per package it installs. `batch` is the
 *  promise the batch settles on; `cancel` is set by a timeout eviction (B2)
 *  so a batch that outlives its caller never starts a queued install and
 *  its late completion writes no states; `releaseGate` frees the chain
 *  gate so the next batch can start even while this one is still hung. */
interface InstallTicket {
  batch: Promise<void>;
  cancel: { current: boolean };
  releaseGate: () => void;
}
const inflight = new Map<string, InstallTicket>();
/** Serialises install batches: two batches never download at once. Each
 *  batch owns a gate promise; the gate resolves when the batch settles OR
 *  when a timeout evicts it (B2) — so a hung batch can never wedge the
 *  chain: eviction, not the batch's own settlement, advances it. */
let chain: Promise<void> = Promise.resolve();
/** How many install batches actually started (P-08: concurrent calls install once). */
let installsStarted = 0;

const stateOf = (name: string): PackageState =>
  states.get(name) ?? { status: "not-loaded" };

/** The repo installs read from: the bundled repo by default. Tests point it
 *  at a localhost server for the same directory. `null` means webR's default
 *  (the CDN repo root). Never a user-supplied URL. */
let repoUrl: string = BUNDLED_REPO_URL;
let allowCdnFallback = true;

export function setPackageRepo(url: string | null, opts?: { allowCdnFallback?: boolean }) {
  repoUrl = url ?? CDN_REPO_URL;
  if (opts?.allowCdnFallback !== undefined) allowCdnFallback = opts.allowCdnFallback;
}

export function packageRepoSource(): { url: string; allowCdnFallback: boolean } {
  return { url: repoUrl, allowCdnFallback };
}

/** One package's status, for wizards (grey out / explain) and Settings. */
export function packageStatus(name: string): {
  status: PackageStatus;
  version?: string;
  error?: string;
  source?: "bundled" | "cdn";
} {
  const entry = registryByName.get(name);
  const state = stateOf(name);
  return {
    status: state.status,
    version: entry?.version,
    error: state.error,
    source: state.source,
  };
}

/** Diagnostics for tests and Settings: installs started, and every known
 *  package's status. */
export function packageDiagnostics(): {
  installsStarted: number;
  packages: Record<string, { status: PackageStatus; error?: string; source?: "bundled" | "cdn" }>;
} {
  const packages: Record<string, { status: PackageStatus; error?: string; source?: "bundled" | "cdn" }> = {};
  for (const name of new Set([...registryByName.keys(), ...states.keys()])) {
    const s = stateOf(name);
    packages[name] = { status: s.status, error: s.error, source: s.source };
  }
  return { installsStarted, packages };
}

/** The installed version of every `ready` package, for the Settings row.
 *  Versions cross the `evalNamedVector` boundary as numbers: each package
 *  contributes `<name>_n` (component count) + `<name>_1..k` (components),
 *  reassembled here into "3.8.12". A package installed from the bundled repo
 *  is necessarily the pinned version; a CDN install reports what it got. */
export async function installedPackageVersions(): Promise<Record<string, string>> {
  const ready = PACKAGE_REGISTRY.filter((p) => stateOf(p.name).status === "ready").map((p) => p.name);
  if (!ready.length) return {};
  const parts = ready.flatMap((n) => [
    `${JSON.stringify(`${n}_n`)}=length(unlist(packageVersion(${JSON.stringify(n)})))`,
    `${JSON.stringify(`${n}_1`)}=unlist(packageVersion(${JSON.stringify(n)}))[1]`,
    `${JSON.stringify(`${n}_2`)}=unlist(packageVersion(${JSON.stringify(n)}))[2]`,
    `${JSON.stringify(`${n}_3`)}=unlist(packageVersion(${JSON.stringify(n)}))[3]`,
    `${JSON.stringify(`${n}_4`)}=unlist(packageVersion(${JSON.stringify(n)}))[4]`,
    `${JSON.stringify(`${n}_5`)}=unlist(packageVersion(${JSON.stringify(n)}))[5]`,
  ]);
  const out = await evalNamedVector(`c(${parts.join(",")})`);
  const versions: Record<string, string> = {};
  for (const name of ready) {
    const n = out[`${name}_n`];
    if (n == null) continue;
    const comps: number[] = [];
    for (let i = 1; i <= n; i++) {
      const v = out[`${name}_${i}`];
      if (v == null) break;
      comps.push(v);
    }
    if (comps.length === n) versions[name] = comps.join(".");
  }
  return versions;
}

/** `ensurePackages` rejects when the install runs past this long. A timed-out
 *  call EVICTS the stuck batch (B2): its packages leave `inflight`, are
 *  marked `failed` with kind `timeout`, and the chain gate is released, so a
 *  later call starts a fresh install instead of queueing behind the dead
 *  one. The underlying R call itself keeps running in the engine — webR
 *  cannot cancel it — but it can no longer poison anything: a batch evicted
 *  while queued never starts, and its late completion writes no states, so
 *  the retry's install is the one that counts. If the engine itself is
 *  wedged, the retry's install queues behind the hung call in the worker
 *  and times out the same way, bounded, until the engine frees up.
 *
 *  360 s, re-measured 2026-11-12 (B2) — not a guess. The 2026-11-09
 *  120 s budget no longer holds on this host: the largest single batch,
 *  lme4 + lmerTest (21 packages / 27 MB, because lmerTest Imports
 *  ggplot2), now takes 213.6 s cold end to end (base code, fresh engine,
 *  scratch probe `scratch-time-lme4.ts`, shared host at load 6–9 with
 *  other lanes contending) — up from the 71 s worst case measured
 *  2026-11-09. With a 120 s cap the reference suite's mixed-effects
 *  analyses fail even though the install is healthy and progressing;
 *  worse, under B2 eviction the retry then queues behind the still-running
 *  first install in the worker and times out too, so one slow batch fails
 *  twice. The seconds go to WASM-side work, not the network: every .tgz
 *  arrives from localhost in <0.1 s, then R spends ~1–6 s per package
 *  unpacking it and building its lazy-load database, single-threaded,
 *  while the shared host runs at load 6–9. No code change can shrink
 *  that — the closure is the pinned hard-dependency set, and webR cannot
 *  parallelise installs (no fork under Emscripten). 360 s covers the
 *  worst measured batch (213.6 s) with ~1.7x headroom, the same rule the
 *  old 120 s cap used; if the closure grows, re-measure before touching
 *  this again. (A hung install still evicts on timeout — the B2 fix —
 *  it just takes up to 360 s for the caller to learn the install is hung
 *  rather than slow.) */
export const PACKAGE_INSTALL_TIMEOUT_MS = 360_000;

// ── M16 — cross-window install dedup ────────────────────────────────────
// `states`/`inflight`/`chain` above are module-level per project window,
// but installs execute in the one shared engine window — so two windows
// running a package-dependent analysis at once both saw "not-loaded" and
// both started an install batch (measured 2026-11-12: each window's batch
// ran, `installsStarted` counted 2; the second batch's `webr::install` was
// a 0.3 s no-op only because webR skips already-installed packages — the
// redundant batch, the divergent states, and the spurious timeout when one
// window's call outlived the other's install were the real defect, not a
// double 48 s install). The engine's R session is the one shared truth
// every window already reaches (via `evalNamedVector`), and it is
// single-threaded — so the claim lives there, not in JS: one R eval,
// atomic in the worker, claims the missing packages (or reports them
// installed / claimed by another window). No new channel, no Rust change.

/** A claim older than this is treated as abandoned (its holder died or its
 *  install was evicted) and may be stolen. Longer than the install timeout
 *  (360 s) so a live holder is never robbed mid-install. */
export const CLAIM_STALE_MS = 400_000;

/** This window's claim tokens: package -> the unique token this window won
 *  the engine-side install claim with (see `claimInstallCode`). The token
 *  is the ownership proof that lets a later call in this window RECLAIM its
 *  own abandoned claim: a timed-out call's claim can outlive it in the
 *  engine — the fire-and-forget release meant to clear it is dropped by
 *  webR's interrupt (see below) — and the retry must be able to tell "my
 *  own dead claim" from "another window's live install". A token only ever
 *  matches the one claim this window won with it; a live holder in another
 *  window has a different token, so a reclaim can never rob it. Per window
 *  (module-level, like `states`): a second window imports a second module
 *  record with its own empty map, so P-13 dedup is unaffected.
 *
 *  Tokens are cleared when the claim they prove is provably moot — the
 *  package reports installed (install completion), the install fails
 *  terminally (failure — the failed path releases the claim first), a
 *  release is issued for the package, or the engine is reset (the claims
 *  die with the engine). One deliberate exception: a TIMEOUT eviction
 *  keeps the token. The timeout release is best-effort and usually never
 *  lands (see `releaseClaimCode`), so the retry reclaims with this token
 *  instead — that is the P-12 recovery, and clearing here would strand
 *  the retry on code 0 until the 400 s steal window. The token is safe to
 *  keep: exact equality means a stale token can only ever match the one
 *  claim it won, never another window's live claim — and every reclaim
 *  re-win stores a FRESH token (see `claimInstallCode`), so a late
 *  release keyed to the old token is a harmless no-op. */
const claimTokens = new Map<string, string>();

/** One fresh claim token per claim attempt: wall-clock + a per-window
 *  counter + randomness, so two windows (separate module records, separate
 *  counters) can never mint the same token, and two attempts in this
 *  window never reuse one. Characters are R-string-safe (no quotes). */
let claimTokenCounter = 0;
function newClaimToken(): string {
  claimTokenCounter += 1;
  return `c${Date.now().toString(36)}-${claimTokenCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** R code: for each wanted package, 2 = installed at the pinned version,
 *  1 = this caller wins the claim, 0 = another window holds the claim.
 *  One eval, atomic in the single-threaded worker.
 *
 *  Ownership is an exact unique TOKEN, never a timestamp tolerance
 *  (BUG-REPORT Round 2 #89): the engine stores two parallel lists,
 *  `.helix_install_claims` (the win's `Sys.time()`, for the staleness
 *  check only) and `.helix_install_claim_tokens` (the winning token).
 *  `reclaim` (package -> token this window won with) lets a caller
 *  re-win its OWN abandoned claim at once: the stored token matches
 *  exactly, so the claim is dead — its holder timed out and evicted —
 *  not another window's live install (which holds a different token,
 *  and exact `==` can never confuse the two, however close in time the
 *  wins were). `fresh` (package -> a token minted for this attempt) is
 *  what a win STORES: a reclaim re-win rotates to a fresh token, so a
 *  late conditional release keyed to the old token cannot drop the
 *  retry's live claim. Without a reclaim token the slot is won only
 *  when empty or stale, exactly as before. Callers pass a reclaim token
 *  only for packages whose local state is `failed` (a live batch in
 *  this window shows `loading`, and a concurrent same-window caller
 *  must never reclaim it). */
export function claimInstallCode(
  names: string[],
  reclaim?: Map<string, string>,
  fresh?: Map<string, string>,
): string {
  const pkgs = `c(${names.map((n) => JSON.stringify(n)).join(",")})`;
  const vers = `c(${names.map((n) => JSON.stringify(registryByName.get(n)!.version)).join(",")})`;
  const mine = `c(${names.map((n) => JSON.stringify(reclaim?.get(n) ?? "")).join(",")})`;
  const store = `c(${names.map((n) => JSON.stringify(fresh?.get(n) ?? "")).join(",")})`;
  return (
    `pkgs<-${pkgs};vers<-${vers};mine<-${mine};store<-${store};` +
    `claims<-get0(".helix_install_claims",envir=.GlobalEnv,ifnotfound=list());` +
    `tokens<-get0(".helix_install_claim_tokens",envir=.GlobalEnv,ifnotfound=list());` +
    `now<-as.numeric(Sys.time());codes<-numeric(length(pkgs));` +
    `for(i in seq_along(pkgs)){p<-pkgs[i];` +
    `ok<-requireNamespace(p,quietly=TRUE)&&packageVersion(p)==package_version(vers[i]);` +
    `if(ok){codes[i]<-2}else{held<-claims[[p]];heldTok<-tokens[[p]];` +
    `if(is.null(held)||now-held>${CLAIM_STALE_MS / 1000}||(mine[i]!=""&&!is.null(heldTok)&&heldTok==mine[i])){claims[[p]]<-now;tokens[[p]]<-store[i];codes[i]<-1}else{codes[i]<-0}}};` +
    `assign(".helix_install_claims",claims,envir=.GlobalEnv);` +
    `assign(".helix_install_claim_tokens",tokens,envir=.GlobalEnv);` +
    `setNames(codes,pkgs)`
  );
}

/** R code: drop this caller's claims (on failure, so another window's retry
 *  can claim at once instead of waiting out the steal window). Best effort.
 *  CONDITIONAL on the exact token, always — there is no unconditional form
 *  (BUG-REPORT Round 2 #96): a claim is cleared only if the stored token
 *  still equals the one this caller won with. A release eval that lands
 *  late — after a retry reclaimed the package and started a fresh install
 *  under a rotated token — must not drop the retry's live claim, so the
 *  token mismatch makes it a no-op. The same exact-token rule covers the
 *  timeout path: a caller whose claim eval never answered still passes
 *  the tokens that abandoned eval would store on a late win, so the
 *  release queued behind it clears only that zombie win, never another
 *  window's live claim. Packages without a recorded token are left alone:
 *  this caller never owned them.
 *
 *  Why the release cannot be trusted to land at all (measured 2026-11-26,
 *  scratch probe #5): a release eval issued while the engine is busy
 *  queues its Shelter-creation message behind the hung install, and the
 *  hung install's watchdog interrupt calls webR's
 *  `SharedBufferChannelMain.interrupt()`, which does
 *  `inputQueue.reset()` — discarding every queued message. The release's
 *  promise then pends forever (its parked resolver is discarded with the
 *  message) and the claim is never cleared. That is the P-12 root cause:
 *  the owner's deming claim, taken at engine start, was still held —
 *  timestamp unchanged — 44 s after the owner's timeout, while the
 *  engine answered other evals promptly, so the retry spun on code 0
 *  until its watchdog. The reclaim above is the fix: the retry re-wins
 *  its own abandoned claim without depending on a release ever landing.
 *  (Old code recovered by accident: its doubled budgets let the
 *  watchdog grace expire before the repo was released, so `resetR`
 *  wiped the engine — claims included. R2-66's shorter budgets removed
 *  that accidental recovery and exposed the broken release.) */
export function releaseClaimCode(names: string[], tokens: Map<string, string>): string {
  const clears = names
    .filter((n) => tokens.has(n))
    .map(
      (n) =>
        `heldTok<-tokens[[${JSON.stringify(n)}]];` +
        `if(!is.null(heldTok)&&heldTok==${JSON.stringify(tokens.get(n))}){claims[[${JSON.stringify(n)}]]<-NULL;tokens[[${JSON.stringify(n)}]]<-NULL;};`,
    )
    .join("");
  return (
    `claims<-get0(".helix_install_claims",envir=.GlobalEnv,ifnotfound=list());` +
    `tokens<-get0(".helix_install_claim_tokens",envir=.GlobalEnv,ifnotfound=list());` +
    clears +
    `assign(".helix_install_claims",claims,envir=.GlobalEnv);` +
    `assign(".helix_install_claim_tokens",tokens,envir=.GlobalEnv);c(released=1)`
  );
}

/** The timeout PackageError, shared by the claim wait and the install race. */
function timeoutError(names: string[], timeoutMs: number): PackageError {
  return new PackageError(
    "timeout",
    names.join(", "),
    `Installing ${names.map((n) => `“${n}”`).join(", ")} timed out after ${Math.round(timeoutMs / 1000)} seconds — the attempt was abandoned. Try again to start a fresh install.`,
  );
}

/** Resolve the wanted packages against the engine's R: installed ones are
 *  marked ready locally; won ones are left for the batch step below;
 *  ones another window is installing are re-claimed until they resolve.
 *  Returns the packages this caller won the claim for, plus any the engine
 *  never answered for. A claim eval that cannot even start — its Shelter
 *  queues behind a hung install in the single-threaded engine, so the
 *  eval's own watchdog never gets a chance to fire — must never block the
 *  B2 timeout path: on expiry those packages fall back to the per-window
 *  install below instead of throwing, so the batch still starts and times
 *  out on the caller's own timer. The abandoned eval may still win a claim
 *  once the engine frees, so a release is queued behind it (same engine
 *  queue order) to drop whatever it won, instead of poisoning a retry.
 *  Throws a timeout PackageError (and marks the unresolved failed) if the
 *  caller's budget runs out while another window's install is still going
 *  and the engine IS answering.
 *  A win records this window's claim token (see `claimTokens`); a retry
 *  reclaims with it, and the win stores a fresh token (see
 *  `claimInstallCode`). Returns the tokens this call won, so the caller's
 *  timeout release can prove ownership (a token is per call: the
 *  window-level map may since have been overwritten by a later win). */
async function resolveInEngine(
  names: string[],
  deadline: number,
  timeoutMs: number,
): Promise<{ won: string[]; wonTokens: Map<string, string>; unresolved: string[] }> {
  const won: string[] = [];
  const wonTokens = new Map<string, string>();
  let pending = [...names];
  while (pending.length) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      const error = timeoutError(pending, timeoutMs);
      for (const n of pending) states.set(n, { status: "failed", error: error.message, kind: "timeout" });
      throw error;
    }
    let codes: RVector | null;
    // One fresh token per package per attempt: a win stores this token
    // (never the reclaim token — see `claimInstallCode`), and the
    // abandoned-eval release below is keyed to it, so it can only ever
    // clear this attempt's own late win (R2-96).
    const attemptTokens = new Map<string, string>();
    try {
      // Reclaim only what this window previously won AND already failed
      // here: a package `loading` in this window has a live batch, and a
      // concurrent same-window caller must wait for it, never steal it.
      const reclaim = new Map<string, string>();
      for (const n of pending) {
        if (stateOf(n).status === "failed" && claimTokens.has(n)) reclaim.set(n, claimTokens.get(n)!);
        attemptTokens.set(n, newClaimToken());
      }
      codes = await claimEvalWithBudget(pending, remaining, reclaim, attemptTokens);
    } catch (err) {
      if (err instanceof EvalTimeoutError) {
        const error = timeoutError(pending, timeoutMs);
        for (const n of pending) states.set(n, { status: "failed", error: error.message, kind: "timeout" });
        throw error;
      }
      throw err;
    }
    if (codes === null) {
      // The engine never answered within budget (its worker is busy behind
      // a hung install): fall back to the per-window install below — the
      // B2 batch must start and time out on the caller's own timer, not
      // hang here. Queue a release behind the abandoned eval so a claim
      // it wins later cannot poison a retry — conditional on THIS
      // attempt's own tokens (R2-96): never an unconditional deletion,
      // so another window's live claim is never wiped.
      void evalNamedVector(releaseClaimCode(pending, attemptTokens), { timeoutMs: PACKAGE_INSTALL_TIMEOUT_MS }).catch(() => {});
      return { won, wonTokens, unresolved: pending };
    }
    const next: string[] = [];
    for (const n of pending) {
      if (codes[n] === 2) {
        states.set(n, { status: "ready" });
        claimTokens.delete(n);
      } else if (codes[n] === 1) {
        won.push(n);
        const token = attemptTokens.get(n)!;
        wonTokens.set(n, token);
        claimTokens.set(n, token);
      } else next.push(n);
    }
    pending = next;
    if (pending.length) await new Promise((r) => setTimeout(r, 1000));
  }
  return { won, wonTokens, unresolved: [] };
}

/** One claim eval, raced against the caller's remaining budget. The eval
 *  itself has a watchdog, but that only starts once its Shelter is built —
 *  and Shelter creation queues behind a hung install in the engine, so
 *  without this race the wait would be unbounded. `null` = the engine
 *  never answered; the eval stays queued and is abandoned. */
function claimEvalWithBudget(names: string[], budgetMs: number, reclaim?: Map<string, string>, fresh?: Map<string, string>): Promise<RVector | null> {
  return Promise.race([
    evalNamedVector(claimInstallCode(names, reclaim, fresh), { timeoutMs: budgetMs }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), budgetMs)),
  ]);
}

/**
 * Guarantee the named packages are installed and loadable in this engine,
 * then resolve. Concurrent calls for the same package join the one in-flight
 * install; a second call after success is a no-op; a call after failure
 * retries the install — including after a timeout (B2): a timed-out call
 * evicts the stuck batch, so the retry starts a fresh install instead of
 * joining the dead one. Unknown names reject at once with `not-in-registry`
 * and are recorded `failed` — a typo never triggers a download.
 *
 * Installs run through the same `evalNamedVector` path analyses use, so in a
 * project window they execute in the engine window, exactly like R code.
 * Installs read from the bundled repo; on a network/unreachable error they
 * fall back once to the CDN (unless disabled) — a package missing from the
 * bundled repo is a build error and never falls back, so versions cannot
 * drift silently.
 *
 * Two project windows share the one engine, so before starting a batch the
 * caller claims the missing packages in the engine's R (M16): a package
 * already installed at the pinned version resolves at once, a package
 * another window is installing waits for it, and only the claim's winner
 * installs — the per-window `states`/`inflight` above cannot see the
 * other window, but the engine's R can. The claim is best-effort: if the
 * engine never answers it (its worker is busy behind a hung install),
 * the caller installs anyway — the claim must never block B2's timeout
 * and eviction path.
 */
export async function ensurePackages(names: string[], opts?: { timeoutMs?: number }): Promise<void> {
  const wanted = [...new Set(names)];
  for (const name of wanted) {
    if (!/^[A-Za-z0-9.]+$/.test(name) || !registryByName.has(name)) {
      const error = new PackageError(
        "not-in-registry",
        name,
        `The R package “${name}” is not in this build's package registry — no such analysis exists.`,
      );
      states.set(name, { status: "failed", error: error.message, kind: "not-in-registry" });
      throw error;
    }
  }
  if (!wanted.length) return;
  const timeoutMs = opts?.timeoutMs ?? PACKAGE_INSTALL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  // M16: resolve against the engine before deciding what's missing — the
  // local state above cannot see another window's install. Installed ones
  // come back marked ready; won ones are left for the batch below.
  const toResolve = wanted.filter((n) => stateOf(n).status !== "ready" && !inflight.has(n));
  // Unresolved packages (the engine never answered the claim eval) fall
  // through to the batch below exactly like won ones — the claim is
  // best-effort and never gates the install.
  const {
    wonTokens,
  }: { won: string[]; wonTokens: Map<string, string>; unresolved: string[] } = toResolve.length
    ? await resolveInEngine(toResolve, deadline, timeoutMs)
    : { won: [], wonTokens: new Map(), unresolved: [] };
  // Join in-flight installs, then install what's still missing — all decided
  // synchronously, before the first await, so concurrent callers cannot
  // start a second install of the same package.
  const joined = wanted.filter((n) => inflight.has(n)).map((n) => inflight.get(n)!.batch);
  const missing = wanted.filter((n) => stateOf(n).status !== "ready" && !inflight.has(n));
  let batch: Promise<void> | null = null;
  if (missing.length) {
    for (const n of missing) states.set(n, { status: "loading" });
    // The gate resolves when this batch settles OR when a timeout evicts it
    // (B2): the next batch is released by eviction, not by the hung batch.
    const cancel = { current: false };
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    batch = chain.then(() => {
      // Evicted while queued behind a hung batch: never start the install —
      // a zombie install would only contend with the retry that replaced it.
      if (cancel.current) return;
      // BUG-REPORT Round 2 #66: the claim phase above already spent part of
      // this call's budget — the install gets only what is left of the
      // deadline, not a fresh full timeout, or the call's total budget
      // doubles. Nothing left means the call has run out of budget: the
      // batch must fail as a timeout, not return as if the install had
      // run — a bare return resolves the batch, so the caller reports
      // success and the packages stay `loading` forever (P-12: a queued
      // batch after eviction, and a joiner arriving after eviction).
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw timeoutError(missing, timeoutMs);
      return installBatch(missing, cancel, remaining);
    });
    batch.then(
      () => releaseGate(),
      () => releaseGate(),
    );
    chain = gate;
    const ticket: InstallTicket = { batch, cancel, releaseGate };
    for (const n of missing) inflight.set(n, ticket);
    const done = batch.then(
      () => {
        for (const n of missing) if (inflight.get(n)?.batch === batch) inflight.delete(n);
      },
      () => {
        for (const n of missing) if (inflight.get(n)?.batch === batch) inflight.delete(n);
      },
    );
    void done;
  }
  // The timeout covers EVERYTHING this call waits on — the installs it
  // joined as well as its own batch. (Before B2, a caller that only joined
  // a hung install awaited it before the race and hung forever with no
  // timeout at all.)
  //
  // Time this call out: release the claims it won and evict the stuck
  // batch. The claims must go on the timeout path too — the release below
  // only runs when the race resolves, so a timed-out winner would
  // otherwise hold its claim until the steal window and a retry would spin
  // on it (P-12: the deming retry never got past the claim loop). The
  // release eval is best-effort and fire-and-forget: it queues behind the
  // hung install and runs when the engine frees, ahead of the retry's
  // claim. Only this caller's won claims — never another window's live one:
  // the release is conditional on this call's own token, so a release
  // that lands late (after a retry reclaimed the package) is a harmless
  // no-op instead of dropping the retry's live claim — the reclaim
  // re-win rotates to a fresh token, so the old token cannot match it.
  // And the release may never land at all (webR's interrupt drops queued
  // evals — see `releaseClaimCode`); the retry does not depend on it, it
  // reclaims with the recorded token instead. The window-level token is
  // deliberately KEPT on this timeout path (see `claimTokens`): clearing
  // it would strand the retry on code 0 until the steal window.
  const releaseAndEvict = (error: PackageError): void => {
    const toRelease = wanted.filter((n) => wonTokens.has(n));
    if (toRelease.length) {
      void evalNamedVector(releaseClaimCode(toRelease, wonTokens), { timeoutMs: PACKAGE_INSTALL_TIMEOUT_MS }).catch(() => {});
    }
    evictTimedOut(wanted, error);
  };
  // The deadline is already spent and the packages are not all ready: fail
  // now instead of racing a 0 ms timer against the joined batch — the
  // batch promise resolves first (a microtask beats the timer), so the call
  // would resolve successfully for packages that never installed (P-12
  // joiner). A call whose packages are all ready resolves normally.
  if (deadline - Date.now() <= 0 && !wanted.every((n) => stateOf(n).status === "ready")) {
    const error = timeoutError(wanted, timeoutMs);
    releaseAndEvict(error);
    throw error;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    await Promise.race([
      Promise.all([...joined.map((p) => p.catch(() => {})), ...(batch ? [batch] : [])]),
      new Promise<never>((_, reject) => {
        // BUG-REPORT Round 2 #66: the race is bounded by the same deadline
        // as the claim phase above, not a fresh full timeoutMs — otherwise
        // the call waits out the claim budget and then a whole second
        // timeout. The message still names the full budget: that is what
        // the whole call was allowed.
        timer = setTimeout(() => {
          timedOut = true;
          reject(timeoutError(wanted, timeoutMs));
        }, Math.max(0, deadline - Date.now()));
      }),
    ]);
  } catch (err) {
    // A timeout — from the wait race (`timedOut`) or from a batch that ran
    // out of budget before it could start — evicts the stuck batch and
    // releases this caller's claims (see releaseAndEvict above). Any other
    // rejection is not a timeout and evicts nothing.
    if (timedOut || (err instanceof PackageError && err.kind === "timeout")) {
      releaseAndEvict(err as PackageError);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  // BUG-REPORT Round 2 #90: a joined batch settling proves nothing —
  // only `ready` is success. An evicted joined batch settles (its
  // install eval times out and the cancelled batch resolves void) while
  // a retry has already flipped the packages back to `loading`: the old
  // code checked only `failed` here and resolved as success, so the
  // downstream `library(...)` failed. Loop until every wanted package
  // is `ready`, joining whatever batch owns the still-`loading` ones
  // (the retry's), and throw only on a terminal `failed` or when the
  // deadline expires — never on a mere "not failed".
  while (!wanted.every((n) => stateOf(n).status === "ready")) {
    const failed = wanted.filter((n) => stateOf(n).status === "failed");
    if (failed.length) {
      // M16: release the claims this caller won (or still holds a token
      // for, from an earlier timed-out win on an unresolved package), so
      // another window's retry can claim at once instead of waiting out
      // the steal window. Awaited briefly (a prompt retry must see it);
      // if the engine is busy the steal window is the backstop. Only
      // this caller's own claims — never another window's live claim
      // (the release is conditional on this call's exact token). The
      // window-level tokens go with the release: the claim is gone.
      const releaseTokens = new Map<string, string>();
      for (const n of failed) {
        const token = wonTokens.get(n) ?? claimTokens.get(n);
        if (token) releaseTokens.set(n, token);
      }
      if (releaseTokens.size) {
        await Promise.race([
          evalNamedVector(releaseClaimCode([...releaseTokens.keys()], releaseTokens), { timeoutMs: PACKAGE_INSTALL_TIMEOUT_MS }).catch(() => {}),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
        for (const n of releaseTokens.keys()) claimTokens.delete(n);
      }
      const first = failed[0];
      const state = stateOf(first);
      throw new PackageError(
        state.kind ?? "install-failed",
        first,
        state.error ?? `The R package “${first}” could not be installed.`,
      );
    }
    if (Date.now() >= deadline) {
      const error = timeoutError(wanted, timeoutMs);
      releaseAndEvict(error);
      throw error;
    }
    const stillLoading = wanted.filter((n) => stateOf(n).status === "loading");
    const live = [...new Set(stillLoading.filter((n) => inflight.has(n)).map((n) => inflight.get(n)!.batch))];
    if (live.length) {
      await Promise.race([
        Promise.all(live.map((p) => p.catch(() => {}))),
        new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now()))),
      ]);
    } else {
      // Loading with no in-flight batch (transient: an eviction racing a
      // retry's start) — poll briefly and re-check; the deadline check
      // above bounds the wait.
      await new Promise((r) => setTimeout(r, Math.min(100, Math.max(0, deadline - Date.now()))));
    }
  }
}

/** B2 — evict every package this call was waiting on after a timeout, so a
 *  hung batch can never poison a later install:
 *  - the batch is cancelled: a queued start is skipped, and a late
 *    completion writes no states (the retry's install is the one that
 *    counts — even if the evicted attempt eventually succeeds, its
 *    packages stay `failed` until the retry installs them);
 *  - the chain gate is released, so the next batch starts instead of
 *    queueing behind the dead one;
 *  - the packages leave `inflight` and are marked `failed`/`timeout`
 *    (only while still `loading` — a package that already resolved `ready`
 *    is never clobbered).
 *  Idempotent: a second caller evicting the same packages finds no ticket
 *  and does nothing, so the owning caller's own timeout is a harmless no-op.
 *  One exception: a batch that threw before its install started (its budget
 *  was already spent) settles — and its ticket is cleaned up — before the
 *  catch runs, so a package can be `loading` with no ticket. That package
 *  still failed by timeout and is marked so; a package that is already
 *  `failed` or `ready` is never touched. */
function evictTimedOut(names: string[], error: PackageError): void {
  for (const name of names) {
    const ticket = inflight.get(name);
    if (!ticket) {
      if (stateOf(name).status === "loading") {
        states.set(name, { status: "failed", error: error.message, kind: "timeout" });
      }
      continue;
    }
    ticket.cancel.current = true;
    ticket.releaseGate();
    inflight.delete(name);
    if (stateOf(name).status === "loading") {
      states.set(name, { status: "failed", error: error.message, kind: "timeout" });
    }
  }
}

/** One install batch: `webr::install` from a repo, then prove each package
 *  loads (`requireNamespace`). Never throws — failures land in `states`.
 *  A batch evicted by a timeout (`cancel.current`) writes no states at all:
 *  the retry owns the packages now. */
async function installBatch(
  names: string[],
  cancel: { current: boolean },
  timeoutMs: number,
): Promise<void> {
  installsStarted++;
  const attempts: { repos: string | null; source: "bundled" | "cdn" }[] =
    repoUrl === CDN_REPO_URL
      ? [{ repos: null, source: "cdn" }]
      : [
          { repos: repoUrl, source: "bundled" },
          ...(allowCdnFallback ? [{ repos: null as string | null, source: "cdn" as const }] : []),
        ];
  let lastError: PackageError | null = null;
  for (const { repos, source } of attempts) {
    const code =
      `webr::install(c(${names.map((n) => JSON.stringify(n)).join(",")})` +
      `${repos === null ? "" : `, repos=${JSON.stringify(repos)}`}, quiet=TRUE);` +
      `c(${names.map((n) => `${JSON.stringify(n)}=as.numeric(requireNamespace(${JSON.stringify(n)}, quietly=TRUE))`).join(",")})`;
    try {
      // The install eval carries the install budget (BUG-REPORT #26): the
      // default EVAL_TIMEOUT_MS (300 s) used to abort installs before
      // PACKAGE_INSTALL_TIMEOUT_MS (360 s), and classifyInstallError then
      // misread the EvalTimeoutError as "install-failed".
      const loaded = await evalNamedVector(code, { timeoutMs });
      const unloaded = names.filter((n) => loaded[n] !== 1);
      if (!unloaded.length) {
        // Evicted while this install was running (B2): the retry owns these
        // packages now — write nothing, even on success.
        if (!cancel.current) {
          for (const n of names) {
            states.set(n, { status: "ready", source });
            // Install completed: the claim is moot, drop the token.
            claimTokens.delete(n);
          }
        }
        return;
      }
      // Installed (or partially) but the namespace will not load. Diagnose
      // why: the repo may be unreachable, the package absent from it, or a
      // dependency broken. A network diagnosis retries with the CDN below.
      lastError = await diagnoseLoadFailure(unloaded, repos);
      if (lastError.kind === "network" && repos !== null && allowCdnFallback) continue;
      break; // a load failure will not fix itself from another repo
    } catch (err) {
      lastError = classifyInstallError(err, names);
      if (lastError.kind === "network" && repos !== null && allowCdnFallback) continue;
      break;
    }
  }
  const message = lastError?.message ?? `The R packages ${names.map((n) => `“${n}”`).join(", ")} could not be installed.`;
  // As above: an evicted batch never overwrites the retry's states.
  if (!cancel.current) {
    for (const n of names) {
      states.set(n, { status: "failed", error: message, kind: lastError?.kind ?? "install-failed" });
      // Terminal failure: the install is done (failed), so the claim is
      // moot — drop the token. (An evicted batch keeps it: the retry
      // reclaims with it. See `claimTokens`.)
      claimTokens.delete(n);
    }
  }
}

/** An R/eval error while installing: network (retryable, CDN fallback) or a
 *  hard install failure. */
function classifyInstallError(err: unknown, names: string[]): PackageError {
  const detail = err instanceof Error ? err.message : String(err);
  if (/download|unable to access index|Failed to fetch|fetch failed|ECONNREFUSED|ENOTFOUND|NetworkError|network|timed? ?out|TLS|certificate/i.test(detail)) {
    return new PackageError(
      "network",
      names.join(", "),
      `${names.map((n) => `“${n}”`).join(", ")} need${names.length > 1 ? "" : "s"} to be downloaded once — no network connection was found. Check your connection and retry.`,
    );
  }
  return new PackageError(
    "install-failed",
    names.join(", "),
    `Installing ${names.map((n) => `“${n}”`).join(", ")} failed: ${detail}`,
  );
}

/** `requireNamespace` is false after install: is the repo unreachable (the
 *  index cannot even be read — a network error, retryable with the CDN), the
 *  package absent from the repo index (a build error — never fall back), or
 *  present but unloadable (a broken transitive dependency)? */
async function diagnoseLoadFailure(names: string[], repos: string | null): Promise<PackageError> {
  const indexUrl = `${repos ?? CDN_REPO_URL}/bin/emscripten/contrib/${R_MAJOR_MINOR}/PACKAGES`;
  let indexText: string | null = null;
  try {
    const res = await fetch(indexUrl, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) indexText = await res.text();
  } catch {
    // The index could not be read at all: the repo is unreachable.
  }
  if (indexText === null) {
    return new PackageError(
      "network",
      names.join(", "),
      `${names.map((n) => `“${n}”`).join(", ")} need${names.length > 1 ? "" : "s"} to be downloaded once — no network connection was found. Check your connection and retry.`,
    );
  }
  const absent = names.filter((n) => !new RegExp(`^Package: ${n}$`, "m").test(indexText));
  if (absent.length) {
    return new PackageError(
      "not-in-repo",
      absent.join(", "),
      `${absent.map((n) => `“${n}”`).join(", ")} ${absent.length > 1 ? "are" : "is"} not in this build's package library — the app was built without ${absent.length > 1 ? "them" : "it"}. The analyses that need ${absent.length > 1 ? "them" : "it"} cannot run in this build.`,
    );
  }
  return new PackageError(
    "load-failed",
    names.join(", "),
    `The R package${names.length > 1 ? "s" : ""} ${names.map((n) => `“${n}”`).join(", ")} installed but could not be loaded — a dependency it needs is missing from this build.`,
  );
}

/** The user-facing message for a provisioning failure: never a raw R error. */
export function packageErrorMessage(err: unknown): string {
  if (err instanceof PackageError) return err.message;
  return `Could not install the R packages this test needs: ${err instanceof Error ? err.message : String(err)}`;
}
