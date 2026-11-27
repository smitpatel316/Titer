// Versions: whether one comes after another, and the latest one out.

/** Whether version `a` ("v1.10.0") comes after `b` ("1.9"): what the update check asks.
 *
 * Semver precedence: the core is compared numerically, segment by
 * segment; a release outranks a pre-release of the same core
 * ("2.0.2" > "2.0.2-rc.1"), and two pre-releases compare identifier
 * by identifier — numeric identifiers numerically, a numeric
 * identifier below an alphanumeric one, alphanumeric ones lexically,
 * and a shorter list below a longer one that starts with it. Build
 * metadata ("+build") never affects precedence. The old split on "."
 * turned "2.0.2-rc.1" into [2, 0, 2, 1] and called it newer than
 * "2.0.2" (BR-105). */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string): { core: number[]; pre: string[] | null } => {
    const withoutBuild = v.replace(/^v/i, "").split("+")[0] ?? "";
    const dash = withoutBuild.indexOf("-");
    const corePart = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
    const prePart = dash === -1 ? null : withoutBuild.slice(dash + 1);
    return {
      core: corePart.split(".").map((n) => parseInt(n, 10) || 0),
      pre: prePart === null || prePart === "" ? null : prePart.split("."),
    };
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i++) {
    if ((x.core[i] ?? 0) !== (y.core[i] ?? 0)) return (x.core[i] ?? 0) > (y.core[i] ?? 0);
  }
  // Same core: a release outranks any pre-release of it.
  if (x.pre === null && y.pre === null) return false;
  if (x.pre === null) return true;
  if (y.pre === null) return false;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const [xi, yi] = [x.pre[i], y.pre[i]];
    if (xi === undefined) return false; // shorter list is older when it is a prefix
    if (yi === undefined) return true;
    if (xi === yi) continue;
    const [xn, yn] = [Number(xi), Number(yi)];
    const xNumeric = xi !== "" && Number.isInteger(xn);
    const yNumeric = yi !== "" && Number.isInteger(yn);
    if (xNumeric && yNumeric) return xn > yn;
    if (xNumeric) return false; // numeric identifiers sort below alphanumeric ones
    if (yNumeric) return true;
    return xi > yi;
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

/** The latest version out ("2.0.1"); throws when GitHub refuses the read. */
export async function latestVersion(): Promise<unknown> {
  const main = await fetchWithTimeout(MAIN_PACKAGE);
  if (!main.ok) throw new Error(`GitHub answered ${main.status}`);
  return (await main.json()).version;
}
