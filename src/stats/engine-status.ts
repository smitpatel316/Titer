// The R engine's boot status, as a project window knows it — the mirror of
// the engine window's own state (`getEngineBootStatus` in webr.ts). The
// engine window publishes its status on the "r-boot-status" event whenever
// it changes (see `publishEngineBootStatus` in native.ts); a project window
// keeps the latest here so a view can show a failed boot instead of
// leaving the user to discover it on the first analysis (CC-m7). Null
// until the engine has published one — tests and `npm run web` never do,
// so the boot line stays hidden there. (Same shape as the R queue store
// in r-queue.ts.)
import type { EngineBootStatus } from "./webr";

let latest: EngineBootStatus | null = null;
const listeners = new Set<(status: EngineBootStatus) => void>();
export function getEngineStatus(): EngineBootStatus | null {
  return latest;
}
export function setEngineStatus(status: EngineBootStatus): void {
  latest = status;
  for (const listener of listeners) listener(status);
}
export function onEngineStatus(handler: (status: EngineBootStatus) => void): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

/** The boot line a view shows when the engine failed to start: "" while
 *  the engine is booting, ready, or unknown — a failure is the only state
 *  worth interrupting the user with. */
export function engineStatusText(status: EngineBootStatus | null): string {
  if (!status || status.state !== "failed") return "";
  return `The R engine failed to start${status.error ? `: ${status.error}` : ""} — analyses will try starting it again when run.`;
}
