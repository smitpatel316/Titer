// PDF and TIFF export, built from the PNG Plotly already draws (Plotly's
// `toImage` supports png/jpeg/svg/webp only — no PDF/TIFF). Pure module: no
// DOM, no Tauri, so the Node test suite drives it directly.
// v1 is raster-only: a PDF embeds the graph as one image at its printed
// size; a TIFF is the same raster with its DPI written in. Alpha is
// composited onto white (the same rule as JPEG); no transparency, no CMYK.
import { deflate, inflate } from "pako";
import type { ColorMode } from "./vector-export";

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

/** A little-endian TIFF: RGB, PackBits, one strip, X/YResolution = dpi
 *  (rational, unit inch). Reads in Preview, Photoshop, ImageJ.
 *  `colorMode` (seq 216, not yet implemented): "cmyk" / "grayscale". */
export function tiffEncode(image: RgbaImage, dpi: number, colorMode: ColorMode = "color"): Uint8Array {
  if (colorMode !== "color") throw new Error(`TIFF ${colorMode} is not implemented yet (seq 216).`);
  const { width, height } = image;
  const rgb = compositeOnWhite(image);
  const strip = packBits(rgb);
  const bitsOffset = 8 + 2 + 12 * 12 + 4; // header + IFD count + entries + next-IFD
  const xResOffset = bitsOffset + 6;
  const yResOffset = xResOffset + 8;
  const stripOffset = yResOffset + 8;
  const total = stripOffset + strip.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const set16 = (at: number, v: number) => view.setUint16(at, v, true);
  const set32 = (at: number, v: number) => view.setUint32(at, v, true);
  out[0] = 0x49; // "II" — little-endian
  out[1] = 0x49;
  set16(2, 42);
  set32(4, 8);
  set16(8, 12);
  const tags: [number, number, number, number][] = [
    // tag, type, count, value-or-offset (SHORT=3, LONG=4, RATIONAL=5)
    [256, 4, 1, width], // ImageWidth
    [257, 4, 1, height], // ImageLength
    [258, 3, 3, bitsOffset], // BitsPerSample 8,8,8
    [259, 3, 1, 32773], // Compression: PackBits
    [262, 3, 1, 2], // Photometric: RGB
    [273, 4, 1, stripOffset], // StripOffsets
    [277, 3, 1, 3], // SamplesPerPixel
    [278, 4, 1, height], // RowsPerStrip
    [279, 4, 1, strip.length], // StripByteCounts
    [282, 5, 1, xResOffset], // XResolution
    [283, 5, 1, yResOffset], // YResolution
    [296, 3, 1, 2], // ResolutionUnit: inch
  ];
  tags.forEach(([tag, type, count, value], i) => {
    const at = 10 + i * 12;
    set16(at, tag);
    set16(at + 2, type);
    set32(at + 4, count);
    set32(at + 8, value);
  });
  set32(10 + 12 * 12, 0); // no next IFD
  set16(bitsOffset, 8);
  set16(bitsOffset + 2, 8);
  set16(bitsOffset + 4, 8);
  set32(xResOffset, dpi);
  set32(xResOffset + 4, 1);
  set32(yResOffset, dpi);
  set32(yResOffset + 4, 1);
  out.set(strip, stripOffset);
  return out;
}

/** A 24-bit BMP (seq 216, not yet implemented): uncompressed BGR, rows
 *  bottom-up and padded to 4 bytes, DPI written as pixels per meter. */
export function bmpEncode(_image: RgbaImage, _dpi: number): Uint8Array {
  throw new Error("BMP export is not implemented yet (seq 216).");
}

const fmtPt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));

/** A PDF 1.4 with one page at the graph's printed size (points = px × 72/dpi)
 *  and one FlateDecode DeviceRGB image XObject.
 *  `colorMode` (seq 216, not yet implemented): "cmyk" / "grayscale". */
export function pdfEncode(image: RgbaImage, dpi: number, colorMode: ColorMode = "color"): Uint8Array {
  if (colorMode !== "color") throw new Error(`PDF ${colorMode} is not implemented yet (seq 216).`);
  const { width, height } = image;
  const rgb = compositeOnWhite(image);
  const compressed = deflate(rgb);
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
      head: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode /Length ${compressed.length} >>`,
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
