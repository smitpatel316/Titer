// pako has no bundled types. Titer uses only inflate/deflate on byte
// arrays (PNG IDAT decode, PDF FlateDecode) — declare just those.
// (Precedent: src/plotly.d.ts for plotly.js-dist-min.)
declare module "pako" {
  export function inflate(data: Uint8Array): Uint8Array;
  export function deflate(data: Uint8Array): Uint8Array;
}
