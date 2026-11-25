// Plugin Isolation webview — marketplace M5 (seq 437).
//
// The first execution path for third-party plugin JS. Until this lane
// the loader never ran plugin code at all (loader.ts); this module is
// where it starts running, and the guard is wired in from the start.
//
// ── The honest line ──────────────────────────────────────────────────────
// There is no true JS sandbox in a desktop webview. The model is a
// CAPABILITY BOUNDARY, not a sandbox: plugin JS runs in a separate frame
// whose only way to reach the host is the intercepted `titer.*` bridge
// below, and every call through that bridge is checked against the
// plugin's granted permissions before anything runs. A plugin that
// finds a way around the boundary is not contained by it. Every UI
// string this lane adds says so — see PLUGIN_SAFETY_NOTICE, rendered
// by `PluginIsolationNotice` (isolation-view.tsx).
//
// ── What this is, and what it is not ─────────────────────────────────────
// The frame is a sandboxed `<iframe sandbox="allow-scripts">` (no
// `allow-same-origin`, so the frame has an opaque origin and no DOM
// access to the app) whose document is the bundled static asset
// `public/plugin-isolation.html` (PLUGIN_WEBVIEW_FRAME_URL). The asset
// holds the bridge — NO inline `<script>`: the release CSP
// (tauri.conf.json `script-src 'self' ...`, no `'unsafe-inline'`) blocks
// inline scripts in an iframe document, so the old `srcDoc` document
// never ran in production (seq 475). The plugin's entry source arrives
// afterwards by `postMessage` (`buildPluginWebviewInit`) and runs via
// `new Function`, allowed by the CSP's `'unsafe-eval'`. The bridge
// exposes `window.titer` — `call` plus one method per command in the
// closed catalogue — and each method only `postMessage`s the call to the
// host. The host side — the IPC interceptor `interceptPluginCall` — is
// the Tauri Isolation pattern's inspection point: it checks the call
// before it reaches Rust, and only forwards it when the guard allows it.
//
// What it does:
//   - runs plugin JS in a separate frame, never in the app's own window;
//   - routes every plugin `titer.*` call through `dispatchPluginCommand`
//     (ipc-guard.ts) with the calling plugin's granted permissions —
//     the ONLY path plugin calls may take;
//   - denies, fail-closed, undeclared calls, declared-but-ungranted
//     calls, unknown commands, and any call from a torn-down or
//     disabled plugin's frame;
//   - tears a plugin's frame down the moment the plugin is disabled or
//     uninstalled, so no orphan execution survives it.
//
// What it does NOT do:
//   - it is not a sandbox (see the honest line above);
//   - it does not create a separate OS-level webview window — the frame
//     is an iframe inside the app window, which is the web-side form of
//     the Isolation pattern's separate frame;
//   - it never calls the host seams itself. Table/analysis work reaches
//     the host through the handler the caller supplies — the app wires
//     that handler to the existing dispatch seam in
//     src/store/mcp-dispatch.ts for table/analysis work, and to the
//     Tauri dialog commands in src/native.ts for file dialogs. Plugin
//     calls must NEVER go directly to either seam: the guard is the
//     only path in, and this module deliberately imports neither seam.
//     The MCP job channel itself (Rust → `mcp-run-job` → the dispatch
//     seam) is the user's own agent, not plugin code, so the guard is
//     NOT wired into the dispatch seam — that would check plugin grants
//     against the user's own jobs (see ipc-guard.ts).
//   - no Rust/native code from third parties — JS/TS + R only, as the
//     loader already enforces. No new Rust surface was needed: the
//     whole lane is TypeScript.
//
// ── Lifecycle ────────────────────────────────────────────────────────────
// A frame exists only while its plugin is enabled: `launchPluginWebview`
// refuses a disabled (or pending-review, or incompatible) record — via
// M4's `checkPluginDependency` (workflow-dependency.ts), reused here
// rather than a third copy of the check — and `onPluginDisabled` /
// `onPluginUninstalled` tear the frame down. The loader calls those
// hooks itself from `disablePlugin` (loader.ts), and the marketplace
// store calls them from its own disable/uninstall paths too, so no
// disable path can leave a frame running (Round 2 Issue 5, seq 469);
// the interceptor also re-checks liveness against the live registry on
// every call, so a frame whose plugin was disabled without the hook
// still denies on its next call and tears itself down. The view
// component (isolation-view.tsx) owns NO teardown: its effect cleanup
// only drops the `message` listener, so React StrictMode's mount →
// cleanup → remount never mutates the externally owned session
// (seq 475) — teardown belongs to the launcher / disable / uninstall
// paths, never to a component cleanup that React may run speculatively.

import { dispatchPluginCommand } from "./ipc-guard";
import { checkCapability, CapabilityDeniedError, KNOWN_COMMANDS, type TiterCommand } from "./capabilities";
import type { PluginPermission } from "./manifest";
import type { PluginRecord } from "./loader";
import { checkPluginDependency } from "./workflow-dependency";

/** The honest line, in full — the single source for every UI string
 *  this lane adds (dialog, settings, listing copy). */
export const PLUGIN_SAFETY_NOTICE =
  "Plugins run behind a capability boundary, not a sandbox: a plugin can only call the Titer commands you grant it, " +
  "and nothing else. There is no true JS sandbox in a desktop webview — a plugin that finds a way around the " +
  "boundary is not contained by it, so only enable plugins from authors you trust.";

/** The per-plugin form of the honest line, for a listing or a frame header. */
export function isolationNoticeForPlugin(name: string): string {
  return `Plugin “${name}”: ${PLUGIN_SAFETY_NOTICE}`;
}

/** The listing/settings form of the honest line. */
export function pluginListingSafetyLine(name: string): string {
  return isolationNoticeForPlugin(name);
}

/**
 * The iframe sandbox tokens: scripts only. No `allow-same-origin`, so
 * the frame gets an opaque origin and cannot reach the app's DOM, its
 * storage, or its Tauri bridge — its only host access is the
 * `postMessage` bridge to `interceptPluginCall`.
 */
export const PLUGIN_WEBVIEW_SANDBOX = "allow-scripts";

/**
 * The Isolation frame's URL: the bundled static asset
 * `public/plugin-isolation.html`. Vite copies `public/` into `dist`, so
 * this is same-origin in dev (the Vite server) and in release (the Tauri
 * asset protocol), and its external script is allowed by the release CSP
 * (`script-src 'self'`). The frame is NOT a `srcDoc` document: `srcDoc`
 * inline `<script>`s are blocked by that CSP (no `'unsafe-inline'`).
 */
export const PLUGIN_WEBVIEW_FRAME_URL = "/plugin-isolation.html";

/** Host → frame: deliver the plugin id, entry source, and command
 *  catalogue. The frame builds `window.titer` from `commands` and runs
 *  `source` via `new Function`. */
export const PLUGIN_WEBVIEW_INIT_TYPE = "titer-plugin-init";

/** Frame → host: the frame's script has loaded and is waiting for init.
 *  The host answers with a `PLUGIN_WEBVIEW_INIT_TYPE` message (and also
 *  posts init on the iframe's load event — whichever lands first wins;
 *  the frame ignores a duplicate init). */
export const PLUGIN_WEBVIEW_READY_TYPE = "titer-plugin-ready";

/** The host → frame init payload (see `PLUGIN_WEBVIEW_INIT_TYPE`). */
export interface PluginWebviewInit {
  type: typeof PLUGIN_WEBVIEW_INIT_TYPE;
  pluginId: string;
  /** The plugin's entry source, delivered verbatim — never embedded in
   *  HTML, so it needs no `<script>` escaping at all. */
  source: string;
  /** The closed command catalogue: the frame builds one `window.titer`
   *  method per command, so the catalogue stays defined once, here. */
  commands: readonly string[];
}

/**
 * Build the init payload for a frame: the plugin id, its entry source
 * verbatim, and the closed command catalogue. Pure — the view posts the
 * result to the frame on load / on `titer-plugin-ready`.
 */
export function buildPluginWebviewInit(source: string, pluginId: string): PluginWebviewInit {
  return {
    type: PLUGIN_WEBVIEW_INIT_TYPE,
    pluginId,
    source,
    commands: [...KNOWN_COMMANDS],
  };
}

/** One running plugin frame: the plugin, what it was granted, and whether
 *  it is still alive. `calls` / `denied` are counters for the frame's
 *  lifetime, for diagnostics — not a security log. */
export interface PluginWebviewSession {
  pluginId: string;
  pluginName: string;
  entry?: string;
  /** The plugin's entry source, as loaded. Empty when the plugin ships no
   *  entry file (analysis-only plugins have nothing to execute). */
  source: string;
  /** What the plugin was granted when this frame launched. The
   *  interceptor enforces the LIVE grants (see `resolveLivePermissions`),
   *  not this snapshot — a re-enable with fewer permissions narrows the
   *  frame's calls without waiting for a relaunch. */
  grantedPermissions: readonly PluginPermission[];
  status: "running" | "torn-down";
  launchedAt: string;
  calls: number;
  denied: number;
  /** Live enabled check, consulted on every intercepted call. Defaults
   *  to the live registry (a disabled plugin unregisters its analyses
   *  at once — loader.ts), so a frame whose plugin was disabled denies
   *  on its next call even if the teardown hook was missed. */
  checkEnabled: () => boolean;
}

/** Options for launching a frame. */
export interface PluginWebviewLaunchOptions {
  /** The plugin's entry source. Defaults to "" (an analysis-only plugin
   *  with no entry file — the frame runs the bridge and nothing else). */
  source?: string;
  /** Override for the live enabled check (tests, or a host with its own
   *  plugin store). Without one the live registry decides. */
  isEnabled?: () => boolean;
}

const activeWebviews = new Map<string, PluginWebviewSession>();

/**
 * Live granted permissions, as last recorded by the loader's enable path
 * (`confirmEnable`, and `launchPluginWebview` below) — the interceptor's
 * source of truth on every call, not the session's launch-time snapshot.
 * A session's `grantedPermissions` is what the plugin was granted when
 * the frame launched; the map is what it is granted NOW. The two agree
 * whenever the loader is the only grant writer (it is: grants change
 * only at `confirmEnable`, and `disablePlugin` clears the entry). The
 * map is consulted first and the snapshot is only the fallback for a
 * session the loader never recorded (e.g. a test-built session), so a
 * re-enable with a smaller grant set can never leave an old session
 * enforcing the revoked permissions (Round 2 Issue 5, seq 469).
 */
const liveGrantedPermissions = new Map<string, readonly PluginPermission[]>();

/** Record the permissions a plugin currently holds (loader enable path). */
export function setLiveGrantedPermissions(pluginId: string, granted: readonly PluginPermission[]): void {
  liveGrantedPermissions.set(pluginId, [...granted]);
}

/** Forget a plugin's live grants (loader disable path). */
export function clearLiveGrantedPermissions(pluginId: string): void {
  liveGrantedPermissions.delete(pluginId);
}

/** The permissions the interceptor enforces for a session: the live
 *  grants when the loader recorded any, else the session's snapshot. */
function resolveLivePermissions(session: PluginWebviewSession): readonly PluginPermission[] {
  return liveGrantedPermissions.get(session.pluginId) ?? session.grantedPermissions;
}

/** Whether two grant sets hold the same permissions (order-insensitive). */
function sameGrantedPermissions(
  a: readonly PluginPermission[],
  b: readonly PluginPermission[],
): boolean {
  return a.length === b.length && a.every((p) => b.includes(p));
}

/**
 * Launch a plugin's Isolation frame. Refuses a plugin that is not
 * enabled — via M4's dependency check, so "disabled" reports the same
 * "needs plugin X — install it?" notice the workflow engine shows.
 * Launching an already-running plugin returns its live session instead
 * of a second frame — but only when the session still matches the
 * record: if the granted permissions changed (a re-enable with a
 * smaller grant set) or a new entry source was supplied, the stale
 * session is torn down first and a fresh one launched, so a revoked
 * permission can never survive a re-enable inside an old frame
 * (Round 2 Issue 5, seq 469).
 */
export function launchPluginWebview(
  record: PluginRecord,
  opts: PluginWebviewLaunchOptions = {},
): { session: PluginWebviewSession } | { error: string } {
  const dep = checkPluginDependency(
    { pluginId: record.manifest.id },
    () => ({ version: record.manifest.version, enabled: record.status === "enabled" }),
  );
  if (!dep.ok) return { error: dep.notice };
  const existing = activeWebviews.get(record.manifest.id);
  if (existing && existing.status === "running") {
    const samePermissions = sameGrantedPermissions(existing.grantedPermissions, record.grantedPermissions);
    const sameSource = opts.source === undefined || opts.source === existing.source;
    if (samePermissions && sameSource) return { session: existing };
    teardownPluginWebview(record.manifest.id);
  }
  const pluginId = record.manifest.id;
  setLiveGrantedPermissions(pluginId, record.grantedPermissions);
  const session: PluginWebviewSession = {
    pluginId,
    pluginName: record.manifest.name,
    ...(record.manifest.entry !== undefined ? { entry: record.manifest.entry } : {}),
    source: opts.source ?? "",
    grantedPermissions: [...record.grantedPermissions],
    status: "running",
    launchedAt: new Date().toISOString(),
    calls: 0,
    denied: 0,
    checkEnabled:
      opts.isEnabled ??
      (() => checkPluginDependency({ pluginId }).ok),
  };
  activeWebviews.set(pluginId, session);
  return { session };
}

/** The live session for a plugin, if its frame is running. */
export function getPluginWebview(pluginId: string): PluginWebviewSession | undefined {
  const session = activeWebviews.get(pluginId);
  return session && session.status === "running" ? session : undefined;
}

/** Every running frame, by plugin id order. */
export function listPluginWebviews(): PluginWebviewSession[] {
  return [...activeWebviews.values()].sort((a, b) => (a.pluginId < b.pluginId ? -1 : 1));
}

/** Whether a plugin's frame is running right now. */
export function isPluginWebviewRunning(pluginId: string): boolean {
  return getPluginWebview(pluginId) !== undefined;
}

/**
 * Tear a plugin's frame down: no further call from it gets through, and
 * the session leaves the registry. Idempotent — tearing down a frame
 * that is already gone is a no-op that reports nothing was torn down.
 */
export function teardownPluginWebview(pluginId: string): boolean {
  const session = activeWebviews.get(pluginId);
  if (!session || session.status === "torn-down") return false;
  session.status = "torn-down";
  activeWebviews.delete(pluginId);
  return true;
}

/** Tear every running frame down; returns the plugin ids that were torn down. */
export function teardownAllPluginWebviews(): string[] {
  const ids = [...activeWebviews.keys()];
  for (const id of ids) teardownPluginWebview(id);
  return ids;
}

/**
 * Hook for the disable path: call this where the app calls
 * `disablePlugin` (loader.ts). A disabled plugin's frame is torn down
 * at once — no orphan execution survives the disable.
 */
export function onPluginDisabled(pluginId: string): boolean {
  return teardownPluginWebview(pluginId);
}

/** Hook for the uninstall path: same teardown as disabling. */
export function onPluginUninstalled(pluginId: string): boolean {
  return teardownPluginWebview(pluginId);
}

// ── The IPC interceptor ──────────────────────────────────────────────────

/**
 * The host side of one plugin `titer.*` call. The caller supplies the
 * host handler — the app's wiring from a command to its host seam
 * (the dispatch seam for table/analysis work, the Tauri dialog
 * commands for file dialogs). The handler runs ONLY inside
 * `dispatchPluginCommand`, so a denied call never reaches it: the
 * guard is the only path in, and the interceptor never calls a host
 * seam itself.
 */
export type PluginHostHandler = (command: string, args: unknown) => Promise<unknown>;

/**
 * Intercept one call from a plugin frame, in the Tauri Isolation
 * pattern's inspection point: check the frame is still alive and its
 * plugin still enabled, then check the granted permissions through the
 * guard, and only then forward to the host handler. Fail-closed at
 * every step — a torn-down frame, a disabled plugin, an undeclared or
 * ungranted command, and an unknown command all deny with
 * `CapabilityDeniedError` and never reach the host.
 */
export async function interceptPluginCall(
  session: PluginWebviewSession,
  command: string,
  args: unknown,
  host: PluginHostHandler,
): Promise<unknown> {
  if (session.status !== "running" || activeWebviews.get(session.pluginId) !== session) {
    session.denied++;
    throw new CapabilityDeniedError(
      command,
      `Plugin “${session.pluginId}” is not running — its webview was torn down, so no call gets through.`,
    );
  }
  if (!session.checkEnabled()) {
    session.denied++;
    teardownPluginWebview(session.pluginId);
    throw new CapabilityDeniedError(
      command,
      `Plugin “${session.pluginId}” is disabled — its webview was torn down, so no call gets through.`,
    );
  }
  try {
    // Enforce the LIVE grants, not the session's launch-time snapshot:
    // a re-enable with fewer permissions must narrow what this frame
    // may call even before any relaunch (Round 2 Issue 5, seq 469).
    const result = await dispatchPluginCommand(
      { pluginId: session.pluginId, grantedPermissions: resolveLivePermissions(session) },
      command,
      () => host(command, args),
    );
    session.calls++;
    return result;
  } catch (err) {
    session.denied++;
    throw err;
  }
}

// ── Host wiring ──────────────────────────────────────────────────────────

/** The host handlers for each command, supplied by the app. A command
 *  with no handler here is not callable — it fails closed, it does not
 *  fall through to a host seam. */
export type PluginHostHandlers = Partial<Record<TiterCommand, PluginHostHandler>>;

/**
 * Build the host handler from the app's per-command implementations:
 * the table/analysis commands point at the dispatch seam, the file
 * commands at the Tauri dialog commands. An unknown command denies
 * (fail-closed, same wording as the capability check); a known command
 * with no handler wired denies too — a granted capability with no host
 * implementation is not a hole to fall through.
 */
export function createPluginHostRouter(handlers: PluginHostHandlers): PluginHostHandler {
  return async (command: string, args: unknown) => {
    if (!(KNOWN_COMMANDS as readonly string[]).includes(command)) {
      const check = checkCapability([], command);
      throw new CapabilityDeniedError(
        command,
        check.allowed ? `“${command}” is not a Titer plugin command, so it cannot be called.` : check.reason,
      );
    }
    const handler = (handlers as Partial<Record<string, PluginHostHandler>>)[command];
    if (!handler) {
      throw new CapabilityDeniedError(
        command,
        `No host handler for “${command}” — the command is granted but Titer has no host implementation wired for it, so it fails closed.`,
      );
    }
    return handler(command, args);
  };
}

// ── The frame document ───────────────────────────────────────────────────

/** Escape entry source so it cannot break out of its `<script>` tag in
 *  the frame document and inject a second script. */
export function escapePluginSource(source: string): string {
  return source.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

/**
 * Build the frame document: the bridge first, then the plugin's entry
 * source. The bridge exposes `window.titer` — `call` plus one method
 * per command in the closed catalogue — and every method only posts
 * the call to the host, where `interceptPluginCall` inspects it. The
 * frame exposes no host seam: no Tauri bridge, no dispatch seam, no
 * direct file or network access — a call that is not in the catalogue
 * has no method and no path to the host.
 *
 * @deprecated The release CSP blocks inline `<script>`s, so a `srcDoc`
 * document built by this function never runs in production (seq 475).
 * Kept only for the M5 pin and any existing importers — new code must
 * use the bundled asset (`PLUGIN_WEBVIEW_FRAME_URL`) plus
 * `buildPluginWebviewInit`. Do not render its output in an iframe.
 */
export function buildPluginWebviewSrcDoc(source: string, pluginId: string): string {
  const methods = KNOWN_COMMANDS.map((c) => {
    const name = c.slice("titer.".length);
    return `    ${name}: function (args) { return call(${JSON.stringify(c)}, args); },`;
  }).join("\n");
  const bridge = [
    "<script>",
    "(function (pluginId) {",
    "  var nextId = 0;",
    "  var pending = {};",
    "  function call(command, args) {",
    "    return new Promise(function (resolve, reject) {",
    "      var id = ++nextId;",
    "      pending[id] = { resolve: resolve, reject: reject };",
    "      window.parent.postMessage({ type: \"titer-plugin-call\", pluginId: pluginId, command: command, args: args || null, id: id }, \"*\");",
    "    });",
    "  }",
    "  window.addEventListener(\"message\", function (event) {",
    "    var data = event.data || {};",
    "    if (data.type !== \"titer-plugin-result\" || data.pluginId !== pluginId) return;",
    "    var p = pending[data.id];",
    "    if (!p) return;",
    "    delete pending[data.id];",
    "    if (data.ok) p.resolve(data.result); else p.reject(new Error(data.error || \"Plugin call failed.\"));",
    "  });",
    "  window.titer = {",
    "    call: call,",
    methods,
    "  };",
    `})(${JSON.stringify(pluginId)});`,
    "</script>",
  ].join("\n");
  return (
    "<!doctype html>\n" +
    `<!-- ${PLUGIN_SAFETY_NOTICE} -->\n` +
    "<html><head><meta charset=\"utf-8\"></head><body>\n" +
    bridge +
    "\n<script>\n" +
    escapePluginSource(source) +
    "\n</script>\n" +
    "</body></html>"
  );
}
