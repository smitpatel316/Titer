// Baseline TIFF and BMP encoders over RGBA pixels — pure functions, no DOM.
// Prism scripts export graphs as TIF (and BMP); the app's own exporters only
// write PNG/JPEG/SVG, so a script's ExportTIF/ExportBMP encodes here from
// the RGBA pixels a canvas read back (see script-graph-export.ts).

export type TiffMode = "rgbhi" | "gray" | "mono";

export interface ImageEncodeOptions {
  mode?: TiffMode;
  /** Dots per inch, written into the file so other apps place it at its printed size. */
  dpi: number;
  /** Transparent background where the format supports it (TIFF: an alpha channel; BMP: 32-bit). */
  clear?: boolean;
}

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];

/** Luminance of one RGB pixel, as Prism's GRAY/MONO modes see it (Rec. 601). */
const luminance = (r: number, g: number, b: number) => Math.round(0.299 * r + 0.587 * g + 0.114 * b);

/** The pixels as one uncompressed strip, in `mode`'s samples. */
function stripPixels(rgba: Uint8Array, width: number, height: number, mode: TiffMode, clear: boolean): Uint8Array {
  if (mode === "mono") {
    // 1 bit per pixel, MSB first, each row padded to a whole byte.
    const rowBytes = Math.ceil(width / 8);
    const out = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (luminance(rgba[i], rgba[i + 1], rgba[i + 2]) >= 128) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return out;
  }
  if (mode === "gray") {
    const out = new Uint8Array(width * height);
    for (let p = 0; p < width * height; p++) {
      const i = p * 4;
      out[p] = luminance(rgba[i], rgba[i + 1], rgba[i + 2]);
    }
    return out;
  }
  const samples = clear ? 4 : 3;
  const out = new Uint8Array(width * height * samples);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    out[p * samples] = rgba[i];
    out[p * samples + 1] = rgba[i + 1];
    out[p * samples + 2] = rgba[i + 2];
    if (clear) out[p * samples + 3] = rgba[i + 3];
  }
  return out;
}

/** A baseline TIFF: little-endian, one strip, no compression. `rgba` is row-major,
 *  top row first. `mode` picks the samples (RGBhi / GRAY / MONO); `clear` adds an
 *  alpha channel to an RGB image. X/YResolution carry `dpi`. */
export function encodeTiff(
  rgba: Uint8Array,
  width: number,
  height: number,
  { mode = "rgbhi", dpi, clear = false }: ImageEncodeOptions,
): Uint8Array {
  const samples = mode === "rgbhi" ? (clear ? 4 : 3) : 1;
  const strip = stripPixels(rgba, width, height, mode, clear);
  const bits = mode === "mono" ? [1] : mode === "gray" ? [8] : clear ? [8, 8, 8, 8] : [8, 8, 8];
  const photometric = mode === "rgbhi" ? 2 : 1; // 2 = RGB, 1 = BlackIsZero
  // Entries, by tag id. A SHORT value fits in the value field itself; a longer
  // one (BitsPerSample, the two RATIONALs) lives past the IFD, pointed at.
  type Entry = { tag: number; type: number; count: number; value: number | number[] };
  const entries: Entry[] = [
    { tag: 256, type: 4, count: 1, value: width },
    { tag: 257, type: 4, count: 1, value: height },
    { tag: 258, type: 3, count: samples, value: bits },
    { tag: 259, type: 3, count: 1, value: 1 }, // no compression
    { tag: 262, type: 3, count: 1, value: photometric },
    { tag: 273, type: 4, count: 1, value: 0 }, // StripOffsets — filled in below
    { tag: 277, type: 3, count: 1, value: samples },
    { tag: 278, type: 4, count: 1, value: height },
    { tag: 279, type: 4, count: 1, value: strip.length },
    { tag: 282, type: 5, count: 1, value: [dpi, 1] }, // XResolution
    { tag: 283, type: 5, count: 1, value: [dpi, 1] }, // YResolution
    { tag: 284, type: 3, count: 1, value: 1 }, // chunky
    { tag: 296, type: 3, count: 1, value: 2 }, // inch
  ];
  if (clear && mode === "rgbhi") entries.push({ tag: 338, type: 3, count: 1, value: 1 }); // unassociated alpha
  entries.sort((a, b) => a.tag - b.tag);
  const typeSize = (t: number) => ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 })[t] ?? 1;
  const ifdOffset = 8;
  const ifdBytes = 2 + entries.length * 12 + 4;
  // Values that don't fit in 4 bytes go after the IFD, in entry order.
  let extra = ifdOffset + ifdBytes;
  const placed = entries.map((e) => {
    const bytes = e.count * typeSize(e.type);
    if (bytes <= 4) return { ...e, at: -1 };
    const at = extra;
    extra += bytes;
    return { ...e, at };
  });
  const stripOffset = extra;
  for (const e of placed) if (e.tag === 273) e.value = stripOffset;
  const out = new Uint8Array(stripOffset + strip.length);
  out[0] = 0x49;
  out[1] = 0x49; // "II"
  out.set(u16(42), 2);
  out.set(u32(ifdOffset), 4);
  out.set(u16(entries.length), ifdOffset);
  const writeValue = (at: number, e: (typeof placed)[number]) => {
    const v = e.value;
    if (e.type === 3) {
      const list = Array.isArray(v) ? v : [v];
      list.forEach((n, i) => out.set(u16(n as number), at + i * 2));
    } else if (e.type === 4) {
      out.set(u32(v as number), at);
    } else if (e.type === 5) {
      const [num, den] = v as number[];
      out.set(u32(num), at);
      out.set(u32(den), at + 4);
    }
  };
  placed.forEach((e, i) => {
    const at = ifdOffset + 2 + i * 12;
    out.set(u16(e.tag), at);
    out.set(u16(e.type), at + 2);
    out.set(u32(e.count), at + 4);
    if (e.at === -1) writeValue(at + 8, e);
    else {
      out.set(u32(e.at), at + 8);
      writeValue(e.at, e);
    }
  });
  out.set(u32(0), ifdOffset + 2 + entries.length * 12); // no next IFD
  out.set(strip, stripOffset);
  return out;
}

/** A BMP: 24-bit (BGR, bottom-up, rows padded to 4 bytes), or 32-bit (BGRA)
 *  with `clear`. `rgba` is row-major, top row first. */
export function encodeBmp(
  rgba: Uint8Array,
  width: number,
  height: number,
  { dpi, clear = false }: ImageEncodeOptions,
): Uint8Array {
  const bpp = clear ? 32 : 24;
  const rowBytes = Math.floor((bpp * width + 31) / 32) * 4;
  const pixels = rowBytes * height;
  const out = new Uint8Array(54 + pixels);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d; // "BM"
  view.setUint32(2, out.length, true);
  view.setUint32(10, 54, true); // pixel data offset
  view.setUint32(14, 40, true); // DIB header size
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive: bottom-up
  view.setUint16(26, 1, true);
  view.setUint16(28, bpp, true);
  view.setUint32(34, pixels, true);
  const ppm = Math.round(dpi / 0.0254);
  view.setInt32(38, ppm, true);
  view.setInt32(42, ppm, true);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    const dst = 54 + y * rowBytes;
    for (let x = 0; x < width; x++) {
      const i = src + x * 4;
      const o = dst + x * (bpp / 8);
      out[o] = rgba[i + 2];
      out[o + 1] = rgba[i + 1];
      out[o + 2] = rgba[i];
      if (clear) out[o + 3] = rgba[i + 3];
    }
  }
  return out;
}
