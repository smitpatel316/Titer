// The message for a failed Tauri `invoke`: Tauri 2 rejects with a plain
// string, so a string rejection carries the specific Rust message
// (BUG-REPORT #109: `open_file`'s "…couldn't be found…" was discarded for
// the generic fallback). Only a non-string, non-Error rejection falls back.
export const invokeErrorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : typeof err === "string" && err ? err : fallback;
