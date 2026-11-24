// SHA-256 for marketplace downloads — Web Crypto, so the same code runs in
// the Tauri webview and in Node (tests). A missing subtle crypto fails
// CLOSED: the install is refused rather than installed unverified.

/** The lowercase hex SHA-256 of `bytes`. Throws when no crypto is available. */
export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SHA-256 is unavailable here — refusing to install a plugin without a hash check.");
  }
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether `bytes` hash to `expectedHex` (case-insensitive, whitespace-tolerant). */
export async function verifySha256(bytes: Uint8Array | ArrayBuffer, expectedHex: string): Promise<boolean> {
  const actual = await sha256Hex(bytes);
  return actual.toLowerCase() === expectedHex.trim().toLowerCase();
}
