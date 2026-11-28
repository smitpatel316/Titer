// The plugin host mount (diff (5)): the dialog that shows an enabled
// plugin's Isolation panel, and the hook that builds its host router.
//
// The frame itself is launched by the marketplace store when the plugin
// is enabled (`MarketplaceStore.confirmEnable` launches it from the
// entry source cached at install). This file is the other half of the
// mount: the panel dialog renders the live session through
// `PluginIsolationWebview`, and the router built here — the app's real
// seams (live store, job dispatch, save dialog, link opener) — is
// passed as `host`, so the frame's calls reach the app through
// `interceptPluginCall`.
//
// The dialog opens from the marketplace's "Open" button, via the
// `plugin-panel` selector kind; it renders from AppShell next to the
// marketplace dialog.
import * as React from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Dialog } from "../ui/dialog";
import { openUrl, writeFile } from "../native";
import { useProjectActions, useProjectStore } from "../store/use-project-store";
import { executeJob, waitForRevision, type JobDeps } from "../store/mcp-dispatch";
import type { McpJob } from "../native";
import type { ProjectNode, TableData } from "../store/types";
import { seriesKeyOf } from "../lib/columns";
import { getMarketplaceStore } from "../marketplace/wiring";
import type { MarketplaceStore } from "../marketplace/store";
import { buildPluginHostRouterFor, type PluginHostDeps, type PluginHostIdentity } from "./plugin-host";
import type { PluginDispatchFn } from "./host-import";
import { getPluginWebview, type PluginHostHandler } from "./isolation";
import { PluginIsolationWebview } from "./isolation-view";

/** Resolve a table from the live store: the named table, or the active
 *  one when no id is given. Throws plainly when there is no table. */
function resolveTable(
  getState: () => { nodes: Record<string, ProjectNode>; activeNodeId: string | null },
  tableId?: string,
): { tableId: string; node: ProjectNode; data: TableData } {
  const state = getState();
  const node =
    tableId !== undefined
      ? state.nodes[tableId]
      : state.activeNodeId !== null
        ? state.nodes[state.activeNodeId]
        : undefined;
  if (node === undefined) throw new Error("No table is open.");
  if (node.data === undefined) throw new Error(`“${node.name}” has no table data.`);
  return { tableId: node.id, node, data: node.data };
}

/**
 * Build the plugin host router for one enabled plugin, bound to the
 * app's real seams. Returns null when there is no plugin to serve
 * (the panel is closed) — the router is only built while a panel is
 * open. The dispatch seam is the same `executeJob` path the MCP
 * dispatcher uses, bound to the open project.
 */
export function usePluginHostRouter(identity: PluginHostIdentity | null): PluginHostHandler | null {
  const store = useProjectStore();
  const actions = useProjectActions();
  // Captured once: both read the latest state through refs (`get` reads
  // `latest.current`; the actions are memoised once in the provider), so
  // the router below never goes stale.
  const getState = store.get;
  const cacheAnalysisResult = actions.cacheAnalysisResult;
  const createAnalysis = actions.createAnalysis;
  const createPluginAnalysis = actions.createPluginAnalysis;
  const renameNode = actions.renameNode;
  const setAnalysisParams = actions.setAnalysisParams;
  // The table branches dispatch through these actions; after a dispatch
  // they need the store to have settled before reading the new state
  // back — two macrotasks, by which time React has flushed the render
  // and the layout effects that keep `latest` current. The read-back
  // branches wait on the store's monotonic `revision` instead (the
  // v1.6 race fix). Copied from `useMcpJobDispatcher` — the router's
  // dispatch is the same job path, so it settles the same way.
  const flush = () => new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 0), 0));
  const flushUntilRevision = async (before: number, timeoutMs = 2000) => {
    await flush();
    await waitForRevision(() => getState().revision, before, timeoutMs);
  };

  const dispatch: PluginDispatchFn = async (action, args) => {
    const job: McpJob = {
      job_id: crypto.randomUUID(),
      // The frontend has no project UUID — identity is the file path, and
      // the id is only echoed in results, so the path is enough.
      project_id: getState().filePath ?? "untitled",
      action,
      args,
      status: "queued",
    };
    const jobDeps: JobDeps = {
      getState,
      cacheAnalysisResult,
      createAnalysis,
      createPluginAnalysis,
      renameNode,
      setAnalysisParams,
      flush,
      flushUntilRevision,
    };
    const completion = await executeJob(job, jobDeps);
    return completion.result;
  };

  const readTable = async (args: { tableId?: string }): Promise<unknown> => {
    const { tableId, node, data } = resolveTable(getState, args.tableId);
    return { tableId, name: node.name, columns: data.columns, rows: data.rows };
  };

  const readColumns = async (args: { tableId?: string }): Promise<unknown> => {
    const { tableId, node, data } = resolveTable(getState, args.tableId);
    return {
      tableId,
      tableName: node.name,
      name: node.name,
      columns: data.columns.map((name) => ({ id: seriesKeyOf(name), name })),
    };
  };

  const saveFile = async (args: {
    filename: string;
    dataBase64?: string;
    data?: ArrayBuffer;
    contentType?: string;
  }): Promise<unknown> => {
    const dot = args.filename.lastIndexOf(".");
    const ext = dot > 0 && dot < args.filename.length - 1 ? args.filename.slice(dot + 1) : undefined;
    const path = await save({
      title: `Save ${args.filename}`,
      defaultPath: args.filename,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
    });
    if (typeof path !== "string") throw new Error("Save cancelled.");
    const bytes =
      args.data !== undefined
        ? new Uint8Array(args.data)
        : Uint8Array.from(atob(args.dataBase64 ?? ""), (c) => c.charCodeAt(0));
    await writeFile(path, bytes);
    return { path };
  };

  const openLink = async (args: { url: string }): Promise<unknown> => {
    await openUrl(args.url);
    return { ok: true };
  };

  if (identity === null) return null;
  const deps: PluginHostDeps = {
    dispatch,
    readTable,
    readColumns,
    saveFile,
    openLink,
  };
  return buildPluginHostRouterFor(identity, deps);
}

/**
 * The plugin panel dialog: an enabled plugin's Isolation frame, with
 * its host router. Opened from the marketplace's "Open" button via the
 * `plugin-panel` selector kind. When the frame isn't running — the
 * plugin was enabled before this session's entry source was cached
 * (see the store's `entrySourceCache` note), or it has no entry file —
 * it says so plainly instead of rendering an empty frame.
 */
export function PluginPanelDialog(): React.JSX.Element {
  const { selector, closeSelector } = useProjectStore();
  const open = selector?.kind === "plugin-panel";
  const pluginId = open ? selector.pluginId : null;
  const [store, setStore] = React.useState<MarketplaceStore | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getMarketplaceStore()
      .then((s) => {
        if (!cancelled) setStore(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const record = pluginId !== null ? store?.getInstalled(pluginId) : undefined;
  const session = pluginId !== null ? getPluginWebview(pluginId) : undefined;
  const identity: PluginHostIdentity | null =
    pluginId !== null && record !== undefined
      ? { id: pluginId, networkHosts: record.manifest.networkHosts }
      : null;
  const router = usePluginHostRouter(identity);

  return (
    <Dialog
      open={open}
      onClose={closeSelector}
      title={record?.manifest.name ?? "Plugin panel"}
      description={record?.manifest.description}
    >
      {loadError !== null ? (
        <p className="text-regular text-secondary">Could not load the plugin store: {loadError}</p>
      ) : store === null ? (
        <p className="text-regular text-secondary">Loading…</p>
      ) : record === undefined ? (
        <p className="text-regular text-secondary">This plugin is not installed.</p>
      ) : session === undefined || router === null ? (
        <p className="text-regular text-secondary">
          “{record.manifest.name}” isn’t running right now — its panel starts when the plugin is enabled. Disable
          and re-enable it from the marketplace to start the panel.
        </p>
      ) : (
        <div className="h-[480px]">
          <PluginIsolationWebview session={session} host={router} />
        </div>
      )}
    </Dialog>
  );
}
