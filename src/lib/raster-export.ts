// PDF and TIFF export, built from the PNG Plotly already draws (Plotly's
// `toImage` supports png/jpeg/svg/webp only — no PDF/TIFF). Pure module: no
// DOM, no Tauri, so the Node test suite drives it directly.
// v1 is raster-only: a PDF embeds the graph as one image at its printed
// size; a TIFF is the same raster with its DPI written in. Alpha is
// composited onto white (the same rule as JPEG); no transparency, no CMYK.
import { deflate, inflate } from "pako";
import { rgbToCmyk, type ColorMode } from "./vector-export";

export type RgbaImage = { width: number; height: number; rgba: Uint8Array };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The 4×3 (or any) PNG Plotly drew, decoded to RGBA. 8-bit, non-interlaced,
 *  colour types 0 (grey), 2 (RGB), 3 (palette), 4 (grey+alpha), 6 (RGBA).
 *  Anything else errors naming the PNG — it is never silently misread. */
export function decodePng(bytes: Uint8Array): RgbaImage {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b))
    throw new Error("Not a PNG file.");
  let at = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let idatLength = 0;
  while (at + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + at, 8);
    const length = view.getUint32(0);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (data.length < length) throw new Error("Truncated PNG chunk.");
    if (type === "IHDR") {
      const ihdr = new DataView(data.buffer, data.byteOffset, data.length);
      width = ihdr.getUint32(0);
      height = ihdr.getUint32(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      transparency = data;
    } else if (type === "IDAT") {
      idat.push(data);
      idatLength += data.length;
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }
  if (!width || !height) throw new Error("PNG has no IHDR chunk.");
  if (bitDepth !== 8) throw new Error(`PNG with ${bitDepth}-bit samples is not supported (8-bit only).`);
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported.");
  if (![0, 2, 3, 4, 6].includes(colorType)) throw new Error(`PNG colour type ${colorType} is not supported.`);
  if (colorType === 3 && !palette) throw new Error("Paletted PNG has no PLTE chunk.");
  const packed = new Uint8Array(idatLength);
  let offset = 0;
  for (const chunk of idat) {
    packed.set(chunk, offset);
    offset += chunk.length;
  }
  const raw = inflate(packed);
  const channels = colorType === 0 || colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error("PNG image data is truncated.");
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const line = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      const v = row[x]!;
      let recon: number;
      if (filter === 0) recon = v;
      else if (filter === 1) recon = v + a;
      else if (filter === 2) recon = v + b;
      else if (filter === 3) recon = v + Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        recon = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`PNG filter ${filter} is not supported.`);
      line[x] = recon & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 0) {
        const g = line[x]!;
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = transparency?.[g] ?? 255;
      } else if (colorType === 2) {
        rgba[o] = line[x * 3]!;
        rgba[o + 1] = line[x * 3 + 1]!;
        rgba[o + 2] = line[x * 3 + 2]!;
        rgba[o + 3] = 255;
      } else if (colorType === 3) {
        const idx = line[x]!;
        rgba[o] = palette![idx * 3]!;
        rgba[o + 1] = palette![idx * 3 + 1]!;
        rgba[o + 2] = palette![idx * 3 + 2]!;
        rgba[o + 3] = transparency?.[idx] ?? 255;
      } else if (colorType === 4) {
        const g = line[x * 2]!;
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = line[x * 2 + 1]!;
      } else {
        rgba[o] = line[x * 4]!;
        rgba[o + 1] = line[x * 4 + 1]!;
        rgba[o + 2] = line[x * 4 + 2]!;
        rgba[o + 3] = line[x * 4 + 3]!;
      }
    }
    prev = line;
  }
  return { width, height, rgba };
}

/** RGB bytes as luminance bytes (Rec. 601 luma). */
export function rgbToGrayBytes(rgb: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgb.length / 3);
  for (let i = 0; i < out.length; i++)
    out[i] = Math.round(0.299 * rgb[i * 3]! + 0.587 * rgb[i * 3 + 1]! + 0.114 * rgb[i * 3 + 2]!);
  return out;
}

/** RGB bytes as CMYK bytes (naive conversion, no ICC profile). */
export function rgbToCmykBytes(rgb: Uint8Array): Uint8Array {
  const out = new Uint8Array((rgb.length / 3) * 4);
  for (let i = 0; i < rgb.length / 3; i++) {
    const [c, m, y, k] = rgbToCmyk(rgb[i * 3]! / 255, rgb[i * 3 + 1]! / 255, rgb[i * 3 + 2]! / 255);
    out[i * 4] = Math.round(c * 255);
    out[i * 4 + 1] = Math.round(m * 255);
    out[i * 4 + 2] = Math.round(y * 255);
    out[i * 4 + 3] = Math.round(k * 255);
  }
  return out;
}

/** A TIFF's colour depth (seq 216 remainder — Prism's 8-bit vs 24-bit
 *  choice): 24-bit RGB, or 8-bit indexed — up to 256 colours in a palette
 *  (Prism's RGBlow). Only a colour TIFF has a depth choice: grayscale is
 *  8-bit already, CMYK is 32-bit, monochrome is 1-bit, so the depth is
 *  ignored for those modes. */
export type ColorDepth = "24bit" | "8bit";

export const COLOR_DEPTHS: { value: ColorDepth; label: string }[] = [
  { value: "24bit", label: "24-bit (millions of colours)" },
  { value: "8bit", label: "8-bit indexed (256 colours)" },
];

/** RGB bytes reduced to a 256-colour palette and one index per pixel
 *  (Prism's 8-bit indexed TIFF). At most 256 distinct colours are kept
 *  exactly, in first-seen order; more are median-cut to 256 boxes, each
 *  box's palette entry its count-weighted mean. The palette is always
 *  256 entries, padded with black — the TIFF ColorMap always carries
 *  3 × 2^BitsPerSample entries, and no index ever points at the padding.
 *  Every pixel's index is its own colour's box, so no nearest-neighbour
 *  search runs over the palette. */
export function quantizeRgbToPalette(rgb: Uint8Array): { palette: Uint8Array; indices: Uint8Array } {
  const count = rgb.length / 3;
  const seen = new Map<number, { r: number; g: number; b: number; n: number }>();
  const order: { r: number; g: number; b: number; n: number }[] = [];
  for (let p = 0; p < count; p++) {
    const r = rgb[p * 3]!;
    const g = rgb[p * 3 + 1]!;
    const b = rgb[p * 3 + 2]!;
    const key = (r << 16) | (g << 8) | b;
    const found = seen.get(key);
    if (found) found.n++;
    else {
      const entry = { r, g, b, n: 1 };
      seen.set(key, entry);
      order.push(entry);
    }
  }
  // At most 256 colours: each keeps its own palette entry, exactly.
  if (order.length <= 256) {
    const palette = new Uint8Array(256 * 3);
    order.forEach((c, i) => {
      palette[i * 3] = c.r;
      palette[i * 3 + 1] = c.g;
      palette[i * 3 + 2] = c.b;
    });
    const indexOf = new Map<number, number>();
    order.forEach((c, i) => indexOf.set((c.r << 16) | (c.g << 8) | c.b, i));
    const indices = new Uint8Array(count);
    for (let p = 0; p < count; p++)
      indices[p] = indexOf.get((rgb[p * 3]! << 16) | (rgb[p * 3 + 1]! << 8) | rgb[p * 3 + 2]!)!;
    return { palette, indices };
  }
  // More than 256: median-cut the distinct colours into 256 boxes.
  type Box = { r: number; g: number; b: number; n: number }[];
  const boxes: Box[] = [order];
  const rangeOf = (box: Box, ch: 0 | 1 | 2) => {
    let lo = 255;
    let hi = 0;
    for (const c of box) {
      const v = ch === 0 ? c.r : ch === 1 ? c.g : c.b;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo;
  };
  while (boxes.length < 256) {
    let bi = -1;
    let best = 0;
    let bestCh: 0 | 1 | 2 = 0;
    boxes.forEach((box, i) => {
      for (const ch of [0, 1, 2] as const) {
        const range = rangeOf(box, ch);
        if (range > best) {
          best = range;
          bi = i;
          bestCh = ch;
        }
      }
    });
    if (bi < 0) break; // every box is one colour — nothing left to split
    const box = boxes[bi]!;
    const sorted = [...box].sort((a, b) => {
      const av = bestCh === 0 ? a.r : bestCh === 1 ? a.g : a.b;
      const bv = bestCh === 0 ? b.r : bestCh === 1 ? b.g : b.b;
      return av - bv;
    });
    const total = sorted.reduce((n, c) => n + c.n, 0);
    let acc = 0;
    let cut = sorted.length - 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += sorted[i]!.n;
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
    }
    boxes.splice(bi, 1, sorted.slice(0, cut), sorted.slice(cut));
  }
  const palette = new Uint8Array(256 * 3);
  const boxOf = new Map<number, number>();
  boxes.forEach((box, i) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const c of box) {
      r += c.r * c.n;
      g += c.g * c.n;
      b += c.b * c.n;
      n += c.n;
      boxOf.set((c.r << 16) | (c.g << 8) | c.b, i);
    }
    palette[i * 3] = Math.round(r / n);
    palette[i * 3 + 1] = Math.round(g / n);
    palette[i * 3 + 2] = Math.round(b / n);
  });
  const indices = new Uint8Array(count);
  for (let p = 0; p < count; p++)
    indices[p] = boxOf.get((rgb[p * 3]! << 16) | (rgb[p * 3 + 1]! << 8) | rgb[p * 3 + 2]!)!;
  return { palette, indices };
}

/** RGBA composited onto white, as RGB — the JPEG rule, shared by PDF/TIFF. */
export function compositeOnWhite({ width, height, rgba }: RgbaImage): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3]! / 255;
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round(rgba[i * 4 + c]! * a + 255 * (1 - a));
  }
  return rgb;
}

/** PackBits (TIFF compression 32773): literal runs of up to 128 bytes, and
 *  repeats of 3+ identical bytes as one repeat packet. */
export function packBits(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    let run = 1;
    while (i + run < data.length && data[i + run] === data[i] && run < 128) run++;
    if (run >= 3) {
      out.push(257 - run, data[i]!);
      i += run;
      continue;
    }
    const start = i;
    while (i < data.length) {
      let nextRun = 1;
      while (i + nextRun < data.length && data[i + nextRun] === data[i + nextRun - 1] && nextRun < 128) nextRun++;
      // Stop the literal run before a repeat worth encoding (or at 128).
      if (nextRun >= 3 || i - start >= 128) break;
      i++;
    }
    const len = i - start;
    out.push(len - 1);
    for (let j = start; j < i; j++) out.push(data[j]!);
  }
  return new Uint8Array(out);
}

/** RGB bytes as 1-bit-per-pixel rows (MSB first, each row padded to a
 *  whole byte): luminance ≥ 128 is white, below is black — the same
 *  threshold the script TIFF's MONO mode uses. */
export function rgbToMonoBytes(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = Math.ceil(width / 8);
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if (Math.round(0.299 * rgb[i]! + 0.587 * rgb[i + 1]! + 0.114 * rgb[i + 2]!) >= 128)
        out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

/** A little-endian TIFF: RGB / CMYK / grayscale / monochrome / 8-bit
 *  indexed, PackBits, one strip, X/YResolution = dpi (rational, unit
 *  inch). Reads in Preview, Photoshop, ImageJ. CMYK is Photometric 5
 *  with 4 samples, grayscale is Photometric 1 with 1 sample,
 *  monochrome is Photometric 1 with 1 bit per sample (packed rows),
 *  8-bit indexed is Photometric 3 with a 256-entry ColorMap. `depth`
 *  only applies to a colour TIFF — grayscale is 8-bit already, CMYK
 *  32-bit, monochrome 1-bit. */
export function tiffEncode(
  image: RgbaImage,
  dpi: number,
  colorMode: ColorMode = "color",
  depth: ColorDepth = "24bit",
): Uint8Array {
  const { width, height } = image;
  const rgb = compositeOnWhite(image);
  const indexed = depth === "8bit" && colorMode === "color";
  const palette = indexed ? quantizeRgbToPalette(rgb) : null;
  const samples = colorMode === "cmyk" ? 4 : colorMode === "grayscale" || colorMode === "monochrome" || indexed ? 1 : 3;
  const photometric =
    colorMode === "cmyk" ? 5 : colorMode === "grayscale" || colorMode === "monochrome" ? 1 : indexed ? 3 : 2;
  const bits: number[] =
    colorMode === "monochrome"
      ? [1]
      : colorMode === "cmyk"
        ? [8, 8, 8, 8]
        : colorMode === "grayscale" || indexed
          ? [8]
          : [8, 8, 8];
  const data =
    colorMode === "cmyk"
      ? rgbToCmykBytes(rgb)
      : colorMode === "grayscale"
        ? rgbToGrayBytes(rgb)
        : colorMode === "monochrome"
          ? rgbToMonoBytes(rgb, width, height)
          : indexed
            ? palette!.indices
            : rgb;
  const strip = packBits(data);
  const tagCount = indexed ? 13 : 12;
  const bitsOffset = 8 + 2 + 12 * tagCount + 4; // header + IFD count + entries + next-IFD
  const xResOffset = bitsOffset + 8; // BitsPerSample needs 2 bytes/sample (4 max)
  const yResOffset = xResOffset + 8;
  const cmapOffset = yResOffset + 8; // ColorMap: 768 SHORTs, 16-bit each
  const stripOffset = indexed ? cmapOffset + 1536 : yResOffset + 8;
  const total = stripOffset + strip.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const set16 = (at: number, v: number) => view.setUint16(at, v, true);
  const set32 = (at: number, v: number) => view.setUint32(at, v, true);
  out[0] = 0x49; // "II" — little-endian
  out[1] = 0x49;
  set16(2, 42);
  set32(4, 8);
  set16(8, tagCount);
  const tags: [number, number, number, number][] = [
    // tag, type, count, value-or-offset (SHORT=3, LONG=4, RATIONAL=5)
    [256, 4, 1, width], // ImageWidth
    [257, 4, 1, height], // ImageLength
    [258, 3, samples, samples === 1 ? bits[0]! : bitsOffset], // BitsPerSample
    [259, 3, 1, 32773], // Compression: PackBits
    [262, 3, 1, photometric], // Photometric: RGB 2 / palette 3 / CMYK 5 / BlackIsZero 1
    [273, 4, 1, stripOffset], // StripOffsets
    [277, 3, 1, samples], // SamplesPerPixel
    [278, 4, 1, height], // RowsPerStrip
    [279, 4, 1, strip.length], // StripByteCounts
    [282, 5, 1, xResOffset], // XResolution
    [283, 5, 1, yResOffset], // YResolution
    [296, 3, 1, 2], // ResolutionUnit: inch
  ];
  if (indexed) tags.push([320, 3, 768, cmapOffset]); // ColorMap: 256 RGB entries, 16-bit each
  tags.forEach(([tag, type, count, value], i) => {
    const at = 10 + i * 12;
    set16(at, tag);
    set16(at + 2, type);
    set32(at + 4, count);
    set32(at + 8, value);
  });
  // One sample: the BitsPerSample value sits inline in the tag, not at bitsOffset.
  if (samples === 1) {
    const bpsAt = 10 + tags.findIndex(([tag]) => tag === 258) * 12;
    set32(bpsAt + 8, 0);
    set16(bpsAt + 8, bits[0]!);
  }
  set32(10 + tagCount * 12, 0); // no next IFD
  for (let s2 = 0; s2 < samples; s2++) set16(bitsOffset + s2 * 2, bits[s2]!);
  set32(xResOffset, dpi);
  set32(xResOffset + 4, 1);
  set32(yResOffset, dpi);
  set32(yResOffset + 4, 1);
  if (indexed) for (let e = 0; e < 768; e++) set16(cmapOffset + e * 2, palette!.palette[e]! * 257);
  out.set(strip, stripOffset);
  return out;
}

/** A 24-bit BMP: uncompressed BGR, rows bottom-up and padded to 4 bytes,
 *  DPI written as pixels per meter. */
export function bmpEncode(image: RgbaImage, dpi: number): Uint8Array {
  const { width, height } = image;
  const rgb = compositeOnWhite(image);
  const rowSize = Math.floor((width * 3 + 3) / 4) * 4;
  const pixelData = rowSize * height;
  const total = 54 + pixelData;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const ppm = Math.round(dpi / 0.0254);
  out[0] = 0x42; // "BM"
  out[1] = 0x4d;
  view.setUint32(2, total, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true); // BITMAPINFOHEADER
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(30, 0, true); // BI_RGB, uncompressed
  view.setUint32(34, pixelData, true);
  view.setUint32(38, ppm, true);
  view.setUint32(42, ppm, true);
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y; // BMP rows are bottom-up
    for (let x = 0; x < width; x++) {
      const si = (srcRow * width + x) * 3;
      const di = 54 + y * rowSize + x * 3;
      out[di] = rgb[si + 2]!;
      out[di + 1] = rgb[si + 1]!;
      out[di + 2] = rgb[si]!;
    }
  }
  return out;
}

const fmtPt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));

/** A PDF 1.4 with one page at the graph's printed size (points = px × 72/dpi)
 *  and one FlateDecode image XObject — DeviceRGB by default, DeviceCMYK
 *  for "cmyk", DeviceGray for "grayscale". */
export function pdfEncode(image: RgbaImage, dpi: number, colorMode: ColorMode = "color"): Uint8Array {
  const { width, height } = image;
  const rgb = compositeOnWhite(image);
  const data =
    colorMode === "cmyk" ? rgbToCmykBytes(rgb) : colorMode === "grayscale" ? rgbToGrayBytes(rgb) : rgb;
  const colorSpace =
    colorMode === "cmyk" ? "DeviceCMYK" : colorMode === "grayscale" ? "DeviceGray" : "DeviceRGB";
  const compressed = deflate(data);
  const pageWidth = fmtPt((width * 72) / dpi);
  const pageHeight = fmtPt((height * 72) / dpi);
  const content = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;
  const objects: { head: string; stream?: Uint8Array }[] = [
    { head: "<< /Type /Catalog /Pages 2 0 R >>" },
    { head: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      head: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    },
    {
      head: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /BitsPerComponent 8 /ColorSpace /${colorSpace} /Filter /FlateDecode /Length ${compressed.length} >>`,
      stream: compressed,
    },
    { head: `<< /Length ${content.length} >>`, stream: new TextEncoder().encode(content) },
  ];
  const parts: Uint8Array[] = [new TextEncoder().encode("%PDF-1.4\n")];
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(parts.reduce((n, p) => n + p.length, 0));
    const head = new TextEncoder().encode(`${i + 1} 0 obj\n${obj.head}\n`);
    parts.push(head);
    if (obj.stream) {
      parts.push(new TextEncoder().encode("stream\n"), obj.stream, new TextEncoder().encode("\nendstream\n"));
    }
    parts.push(new TextEncoder().encode("endobj\n"));
  });
  const xrefAt = parts.reduce((n, p) => n + p.length, 0);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(new TextEncoder().encode(xref));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
