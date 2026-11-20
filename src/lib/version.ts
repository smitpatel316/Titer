// Versions: whether one comes after another, and the latest one out.

/** Whether version `a` ("v1.10.0") comes after `b` ("1.9"): what the update check asks. */
export function isNewer(a: string, b: string): boolean {
  const parts = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

// The version on main's package.json: the fallback when the update
// channel has never answered (its manifest is the authority once it
// exists). A plain static file, never the GitHub API: the API answers 60
// checks an hour per network (a lab's Macs share one). It runs ahead of a
// release only while that release is being built, so it can only ever
// produce an optional offer, never a forced one.
const MAIN_PACKAGE =
  "https://raw.githubusercontent.com/smitpatel316/Titer/main/package.json";

/** How long an update check may take before it is abandoned: a hung
 *  network used to leave the launch check pending forever — and the
 *  once-a-day key was already written, so no re-check happened for 24 h
 *  (CC-m8). Ten seconds: the channel manifest and the package.json
 *  fallback are both small static files. */
export const UPDATE_CHECK_TIMEOUT_MS = 10_000;

/** `fetch` that gives up after `timeoutMs` instead of hanging forever:
 *  the abort rejects (an `AbortError`), which the callers treat like any
 *  other failed read. */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = UPDATE_CHECK_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** The latest version out ("1.7.3"); throws when GitHub refuses the read. */
export async function latestVersion(): Promise<unknown> {
  const main = await fetchWithTimeout(MAIN_PACKAGE);
  if (!main.ok) throw new Error(`GitHub answered ${main.status}`);
  return (await main.json()).version;
}
