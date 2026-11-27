// Opt-in anonymous error logging (seq 452, 2.0 launch).
//
// What this is: a global capture for uncaught exceptions and unhandled
// promise rejections, reported to the shell's `mcp_log_error` command.
// The shell appends them to a local rotating log and — only when the user
// opted in to error-report sharing — sends a scrubbed copy through the
// feedback channel (same model as feedback sharing: default off, offered
// at first run, toggle in Settings → AI Connections).
//
// What this is NOT: telemetry. Nothing is collected in the background and
// nothing leaves the machine unless the user said Share. The scrubber
// below strips user-identifying paths before anything is stored or sent;
// the shell scrubs again (defense in depth — a hand-edited caller can't
// bypass it), so the two implementations must stay in agreement.

import { isNative, mcpFlushErrorLog, mcpLogError } from "../native";

/** A path token ends at whitespace, a quote, a closing bracket, a comma,
 *  a semicolon, or a colon (the `:12:3` of a stack location survives —
 *  line numbers carry no user data). */
const TOKEN_END = new Set([" ", "\t", "\n", "\r", '"', "'", ")", "]", ",", ";", ":"]);

function skipToken(text: string, from: number): number {
  let i = from;
  while (i < text.length && !TOKEN_END.has(text[i]!)) i++;
  return i;
}

function isHomePrefix(text: string, i: number): boolean {
  return (
    text.startsWith("/Users/", i) ||
    text.startsWith("/home/", i) ||
    text.startsWith("C:\\Users\\", i) ||
    text.startsWith("C:/Users/", i)
  );
}

/** A path only starts at a token boundary (start of text, whitespace, or
 *  punctuation) — the `/` in a relative path like `src/lib/foo.ts` is a
 *  separator mid-word, not an absolute path, and must survive. */
const TOKEN_START_BEFORE = new Set([" ", "\t", "\n", "\r", '"', "'", "(", "[", "{", ",", ";", ":", "="]);

function isTokenStart(text: string, i: number): boolean {
  return i === 0 || TOKEN_START_BEFORE.has(text[i - 1]!);
}

function isWindowsAbsolute(text: string, i: number): boolean {
  const c = text[i];
  return (
    c !== undefined &&
    /[A-Za-z]/.test(c) &&
    text[i + 1] === ":" &&
    (text[i + 2] === "\\" || text[i + 2] === "/")
  );
}

/** Strip user-identifying paths from error text before it is stored or
 *  sent. Home directories (`/Users/<name>/`, `/home/<name>/`,
 *  `C:\Users\<name>\`), `file://` URLs, and any other absolute path become
 *  `[path]`; relative paths (`src/lib/foo.ts:12:3`) survive — they name
 *  app code, not the user. Output is capped so one entry stays bounded. */
export function scrubErrorText(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("file://", i) && isTokenStart(text, i)) {
      out += "[path]";
      i = skipToken(text, i + "file://".length);
      continue;
    }
    if ((isHomePrefix(text, i) || isWindowsAbsolute(text, i)) && isTokenStart(text, i)) {
      out += "[path]";
      // A Windows path starts with a drive letter (`C:`) — the token
      // skip must start past that colon, or it stops there and leaks
      // the rest of the path (`\Users\smit\...`). The `:line` suffix
      // still ends the token, so it survives.
      const afterDrive = text[i + 1] === ":" ? i + 2 : i;
      i = skipToken(text, afterDrive);
      continue;
    }
    if (text[i] === "/" && isTokenStart(text, i)) {
      const end = skipToken(text, i);
      if (text.slice(i + 1, end).includes("/")) {
        out += "[path]";
        i = end;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  if (out.length > 4000) out = `${out.slice(0, 4000)}… [truncated]`;
  return out;
}

/** The action being performed when an error lands — the window title
 *  (the open project), which is the most the frontend knows without
 *  wiring every view. The shell attaches the project file NAME (never a
 *  path) to feedback reports; here the title is enough context. */
function currentAction(): string {
  if (typeof document === "undefined") return "unknown";
  const title = document.title.trim();
  return title === "" ? "unknown" : title;
}

export type ErrorKind = "uncaught-exception" | "unhandled-rejection";

let installed = false;

/** The one startup flush, shared with the crash-report dialog: main.tsx
 *  starts it at launch, and the dialog awaits it before reading the log
 *  — otherwise the dialog mounts while POSTs are still in flight, sees
 *  `sent: false`, and pops up spuriously over a flush that was about to
 *  succeed. Never rejects: a failed flush is not itself an error to
 *  report. */
let startupFlush: Promise<unknown> | null = null;

/** Start the startup flush (main.tsx, once). Idempotent. */
export function startStartupErrorFlush(): void {
  if (startupFlush !== null || !isNative) return;
  startupFlush = mcpFlushErrorLog().catch(() => undefined);
}

/** Await the startup flush, if one started; resolves at once when none
 *  did (web preview, tests, or a dialog mounted before main ran). */
export function awaitStartupErrorFlush(): Promise<void> {
  return startupFlush ? startupFlush.then(() => undefined) : Promise.resolve();
}

/** Install the global capture. Idempotent; a no-op outside the native
 *  shell (web preview, tests). Call once from main.tsx, before render. */
export function installErrorCapture(): void {
  if (installed || !isNative || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    const err = event.error;
    const message = err instanceof Error ? err.message : event.message || "uncaught exception";
    const stack = err instanceof Error ? err.stack ?? "" : "";
    void reportError("uncaught-exception", err instanceof Error ? err.name : "Error", message, stack);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? "unhandled rejection");
    const stack = reason instanceof Error ? reason.stack ?? "" : "";
    void reportError("unhandled-rejection", reason instanceof Error ? reason.name : "UnhandledRejection", message, stack);
  });
}

async function reportError(kind: ErrorKind, errorType: string, message: string, stack: string): Promise<void> {
  try {
    await mcpLogError({ kind, error_type: errorType, message, stack, action: currentAction() });
  } catch {
    // Reporting must never break the app: the local log is best-effort,
    // and a failed report is not itself reported (no infinite loop).
  }
}
