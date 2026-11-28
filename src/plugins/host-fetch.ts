// Host-scoped network fetch — the host side of `titer.fetch` (LabForge R1).
//
// A plugin's network calls never touch the network itself: its JS runs in
// an Isolation frame with no Tauri bridge and no fetch of its own, so every
// call arrives here through `interceptPluginCall` (isolation.ts) and the
// capability guard (the `network` permission must be granted — see
// capabilities.ts). This module is the host implementation the app wires
// into the plugin host router (plugin-host.ts).
//
// ── Host scoping ─────────────────────────────────────────────────────────
// The plugin may only fetch origins declared in its manifest
// (`networkHosts` — a manifest.ts field, PENDING registration; see the
// note on `HostFetchOptions.allowedOrigins`). Anything else denies,
// fail-closed, with a plain-language error the plugin can show the
// scientist. An empty allowlist denies everything: the `network`
// permission alone never opens the network — the hosts must be declared
// too. That is the whole point of "host-scoped": a compromised or
// curious plugin cannot phone an arbitrary server with the scientist's
// pairing token.
//
// ── Contract (the LabForge plugin, `plugin/index.js`) ────────────────────
//   args:   { url, method?, headers?, body?, responseType? }
//   result: { status, body } (+ `bodyEncoding: "base64"` when
//           `responseType` is `"arraybuffer"`)
// A non-2xx status is NOT an error here: the result is returned as-is
// and the plugin turns it into its own failure with the server's
// message. Only a transport failure (DNS, refused, timeout) throws.
// The body is capped (25 MB) so a malicious response cannot exhaust
// the app's memory; the cap is a plain error, never a silent truncate.

import type { PluginHostHandler } from "./isolation";

/** The fetch args a plugin passes to `titer.fetch`. */
export interface HostFetchArgs {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  responseType?: string;
}

/** The fetch result the plugin's `normalizeResponse` expects. */
export interface HostFetchResult {
  status: number;
  body: unknown;
  bodyEncoding?: "base64";
}

/** Methods a plugin may use. CONNECT / TRACE are never proxied. */
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** Headers a plugin must never set through the bridge. `Cookie` is the
 *  important one: the fetch runs in the app window, so ambient cookies
 *  for the target origin would otherwise be exfiltratable by plugin
 *  code. `Authorization` is allowed — it is the plugin's own pairing
 *  token, set by the plugin itself, never ambient. */
const BLOCKED_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "cookie",
  "set-cookie",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "te",
]);

/** Largest response body the host will read (25 MB). */
export const HOST_FETCH_MAX_BODY_BYTES = 25 * 1024 * 1024;

/** Default network timeout (60 s — the LabForge server is a small
 *  on-prem box; a slow first byte is not a failure). */
export const HOST_FETCH_TIMEOUT_MS = 60_000;

/** Whether a URL's origin is fetchable at all: https anywhere, or http
 *  only for a loopback host (local dev servers). Anything else — plain
 *  http to a remote host, any other scheme — is never proxied. */
export function isFetchableOrigin(url: URL): boolean {
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

/** Normalise a declared origin to its canonical form (`URL.origin`:
 *  lowercase host, no path, no trailing slash), or `null` when the
 *  value is not a usable origin. A declaration with a path, userinfo
 *  or an unfetchable scheme is rejected at construction, not per call. */
export function normalizeAllowedOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (!isFetchableOrigin(url)) return null;
  return url.origin;
}

/** The origin of a fetch URL, or `null` when the URL does not parse. */
export function fetchUrlOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function plainError(message: string): Error {
  return new Error(message);
}

/** Validate the plugin's fetch args into a normalised form. Throws a
 *  plain-language Error on anything malformed — the plugin shows the
 *  message to the scientist, so it never carries a stack or internals. */
export function validateHostFetchArgs(args: unknown): {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  responseType: "json" | "text" | "arraybuffer" | "auto";
} {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw plainError("titer.fetch needs { url, method?, headers?, body?, responseType? }.");
  }
  const a = args as Record<string, unknown>;
  if (typeof a.url !== "string" || a.url.trim().length === 0) {
    throw plainError("titer.fetch needs a url.");
  }
  let url: URL;
  try {
    url = new URL(a.url.trim());
  } catch {
    throw plainError(`“${String(a.url)}” is not a URL titer.fetch can fetch.`);
  }
  if (url.username !== "" || url.password !== "") {
    throw plainError("titer.fetch never sends credentials in a URL.");
  }
  if (!isFetchableOrigin(url)) {
    throw plainError(
      url.protocol === "https:" || url.protocol === "http:"
        ? `titer.fetch only fetches https URLs (and http on this computer) — “${url.protocol}//${url.host}” is not allowed.`
        : `titer.fetch cannot fetch “${url.protocol}” URLs.`,
    );
  }
  const method = typeof a.method === "string" && a.method.trim() !== "" ? a.method.trim().toUpperCase() : "GET";
  if (!ALLOWED_METHODS.has(method)) {
    throw plainError(`titer.fetch cannot use the “${method}” method.`);
  }
  if ((method === "GET" || method === "HEAD") && a.body !== undefined) {
    throw plainError(`titer.fetch cannot send a body with ${method}.`);
  }
  const headers: Record<string, string> = {};
  if (a.headers !== undefined) {
    if (typeof a.headers !== "object" || a.headers === null || Array.isArray(a.headers)) {
      throw plainError("titer.fetch headers must be an object of name → value strings.");
    }
    for (const [name, value] of Object.entries(a.headers as Record<string, unknown>)) {
      if (typeof value !== "string") throw plainError(`titer.fetch header “${name}” must be a string.`);
      if (BLOCKED_HEADERS.has(name.toLowerCase())) {
        throw plainError(`titer.fetch cannot set the “${name}” header.`);
      }
      headers[name] = value;
    }
  }
  let body: string | undefined;
  if (a.body !== undefined) {
    if (typeof a.body === "string") {
      body = a.body;
    } else {
      try {
        body = JSON.stringify(a.body);
      } catch {
        throw plainError("titer.fetch body could not be sent as JSON.");
      }
      if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/json";
      }
    }
  }
  const responseTypeRaw = typeof a.responseType === "string" ? a.responseType.trim().toLowerCase() : "";
  let responseType: "json" | "text" | "arraybuffer" | "auto" = "auto";
  if (responseTypeRaw === "") responseType = "auto";
  else if (responseTypeRaw === "json" || responseTypeRaw === "text" || responseTypeRaw === "arraybuffer")
    responseType = responseTypeRaw;
  else throw plainError(`titer.fetch responseType “${String(a.responseType)}” is not json, text or arraybuffer.`);
  return { url: url.href, method, headers, body, responseType };
}

/** Base64-encode an ArrayBuffer without `Buffer` (the host runs in the
 *  webview, where Node's Buffer does not exist). Chunked so a large
 *  download does not blow the argument stack. */
export function arrayBufferToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface HostFetchOptions {
  /** The exact origins this plugin may fetch, as declared in its
   *  manifest (`networkHosts` — PENDING manifest.ts registration).
   *  Empty means nothing is fetchable. Entries are normalised at
   *  construction; a malformed entry throws instead of silently
   *  narrowing the allowlist. */
  allowedOrigins: readonly string[];
  /** Fetch implementation (defaults to the global `fetch`). Tests
   *  inject a stub so no real network is touched. */
  fetchImpl?: typeof fetch;
  /** Network timeout in ms (default `HOST_FETCH_TIMEOUT_MS`). */
  timeoutMs?: number;
}

/**
 * Build the `titer.fetch` host handler for one plugin. The allowlist is
 * bound at construction from the plugin's declared hosts — a call can
 * never widen it, and a plugin can never name another plugin's hosts.
 */
export function createHostFetchHandler(options: HostFetchOptions): PluginHostHandler {
  const allowed = new Set<string>();
  for (const entry of options.allowedOrigins) {
    const origin = normalizeAllowedOrigin(entry);
    if (origin === null) {
      throw plainError(
        `Plugin declares an unusable fetch origin “${String(entry)}” — origins must be https (or http on this computer) with no path.`,
      );
    }
    allowed.add(origin);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? HOST_FETCH_TIMEOUT_MS;

  return async (_command: string, args: unknown): Promise<unknown> => {
    const { url, method, headers, body, responseType } = validateHostFetchArgs(args);
    const origin = new URL(url).origin;
    if (!allowed.has(origin)) {
      throw plainError(
        `This plugin may only fetch ${allowed.size === 0 ? "the hosts it declares" : [...allowed].join(", ")} — “${origin}” is not one of them. Ask the plugin's author to declare it, or the scientist to allow it.`,
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, { method, headers, body, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw plainError(`Fetching “${origin}” timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      }
      throw plainError(`Could not reach “${origin}” — check the server is running and this computer is online.`);
    } finally {
      clearTimeout(timer);
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await res.arrayBuffer();
    } catch {
      throw plainError(`The response from “${origin}” could not be read.`);
    }
    if (bytes.byteLength > HOST_FETCH_MAX_BODY_BYTES) {
      throw plainError(`The response from “${origin}” is larger than 25 MB, so it was not read.`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (responseType === "arraybuffer") {
      return { status: res.status, body: arrayBufferToBase64(bytes), bodyEncoding: "base64" } as HostFetchResult;
    }
    const text = new TextDecoder().decode(bytes);
    if (responseType === "text") return { status: res.status, body: text } as HostFetchResult;
    const wantsJson =
      responseType === "json" || contentType.includes("application/json") || contentType.includes("+json");
    if (wantsJson) {
      if (text.trim() === "") return { status: res.status, body: {} } as HostFetchResult;
      try {
        return { status: res.status, body: JSON.parse(text) } as HostFetchResult;
      } catch {
        if (responseType === "json") {
          throw plainError(`“${origin}” did not return JSON.`);
        }
        return { status: res.status, body: text } as HostFetchResult;
      }
    }
    return { status: res.status, body: text } as HostFetchResult;
  };
}
