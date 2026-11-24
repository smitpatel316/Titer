// Graceful degrade for workflow steps that need a plugin: instead of
// breaking, the workflow layer asks here and shows the notice. The workflow
// step shape doesn't exist yet — this is the dependency declaration +
// missing-plugin notice the workflow layer will call (M4 wires it in).

/** A step's plugin dependency: the plugin it needs, and what it needs it for. */
export interface PluginDependency {
  pluginId: string;
  /** Friendly name for the notice; falls back to the id. */
  pluginName?: string;
  /** The analysis (or step) that needs it, for the notice. */
  analysisId?: string;
}

export interface PluginInstallState {
  installed: boolean;
  enabled: boolean;
}

export type DependencyCheck =
  | { ok: true }
  | { ok: false; pluginId: string; pluginName: string; notice: string; action: "install" | "enable" };

/**
 * Check a step's plugin dependency: usable, or the notice to show instead
 * of breaking. Never throws — an unknown plugin is "not installed".
 */
export function checkPluginDependency(dep: PluginDependency, state: PluginInstallState): DependencyCheck {
  const name = dep.pluginName ?? dep.pluginId;
  if (!state.installed) {
    return {
      ok: false,
      pluginId: dep.pluginId,
      pluginName: name,
      notice: `This step needs plugin “${name}” — install it?`,
      action: "install",
    };
  }
  if (!state.enabled) {
    return {
      ok: false,
      pluginId: dep.pluginId,
      pluginName: name,
      notice: `This step needs plugin “${name}”, which is installed but disabled — enable it?`,
      action: "enable",
    };
  }
  return { ok: true };
}

/** The notice for a missing/disabled plugin, or null when it is usable. */
export function dependencyNotice(dep: PluginDependency, state: PluginInstallState): string | null {
  const checked = checkPluginDependency(dep, state);
  return checked.ok ? null : checked.notice;
}
