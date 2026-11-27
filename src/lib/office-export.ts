// Send to Word / PowerPoint / Keynote (v2 item 19, seq 217): one-click
// export of a graph or layout.
//
// Prism's Send-to-Office buttons place a graph straight into Word or
// PowerPoint, and on Mac its Send to Keynote (Shift-Command-H) places it
// in Keynote. Word/PowerPoint are genuine Office Open XML files — the
// graph's PNG embedded at its physical size, with its title — that the
// user opens in Word/PowerPoint. Keynote is different, and deliberately
// so: a .key is a ZIP of Snappy-framed protobuf (.iwa) files whose schema
// Apple never documented, so there is no file-side .key builder here (a
// hand-rolled .key Keynote may refuse is worse than none — seq 217 scope,
// Nov 2026). Prism itself never wrote a .key either: its Send to Keynote
// is a live-app handoff via AppleScript, and that is what the shell does
// — `send_to_keynote` builds the script itself from the values the page
// passes and runs it in Keynote on macOS, and Keynote saves the real
// .key. The page never hands the shell a script string (BUG-REPORT
// Round 2 Issue 1: a raw script from IPC was arbitrary AppleScript
// execution); `buildKeynoteScript` below remains as the suite-pinned
// shape reference for the exact script the shell builds.
import JSZip from "jszip";

export type OfficeTarget = "word" | "powerpoint" | "keynote";

/** The file extension for a target ("docx" / "pptx" / "key"). */
export const officeExtension = (target: OfficeTarget) =>
  target === "word" ? "docx" : target === "powerpoint" ? "pptx" : "key";

/** The save-dialog title for a target. */
export const officeDialogTitle = (target: OfficeTarget) =>
  target === "word" ? "Send to Word" : target === "powerpoint" ? "Send to PowerPoint" : "Send to Keynote";

const EMU_PER_INCH = 914400;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface OfficeImage {
  /** The graph/layout as PNG bytes (from the existing PNG export). */
  png: Uint8Array;
  /** The graph or figure title, shown above the image. */
  title: string;
  /** The PNG's pixel size — the physical size is pixels / DPI. */
  widthPx: number;
  heightPx: number;
  /** The DPI the PNG was rendered at. */
  dpi: number;
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The image's size in inches, fitted inside `maxW`×`maxH` without cropping. */
function fittedInches(image: OfficeImage, maxW: number, maxH: number) {
  if (!(image.widthPx > 0 && image.heightPx > 0)) throw new Error("Office export needs a positive image size.");
  if (!(image.dpi > 0)) throw new Error("Office export needs a positive DPI.");
  const widthIn = image.widthPx / image.dpi;
  const heightIn = image.heightPx / image.dpi;
  const scale = Math.min(1, maxW / widthIn, maxH / heightIn);
  return { widthIn: widthIn * scale, heightIn: heightIn * scale };
}

function checkPng(png: Uint8Array) {
  if (png.length < PNG_MAGIC.length || !PNG_MAGIC.every((b, i) => png[i] === b))
    throw new Error("Office export needs a PNG image.");
}

/** A PNG's pixel size, read from its IHDR chunk — exact, whatever drew it. */
export function pngSize(png: Uint8Array): { widthPx: number; heightPx: number } | null {
  if (png.length < 24 || !PNG_MAGIC.every((b, i) => png[i] === b)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { widthPx: view.getUint32(16), heightPx: view.getUint32(20) };
}

const emu = (inches: number) => Math.round(inches * EMU_PER_INCH);

/** A .docx: each graph's title as a heading paragraph, then its image
 *  centred in the 6.5×9 in text area of a letter page — one title +
 *  image per graph, in order. One image builds exactly the one-graph
 *  document `buildOfficeDocument` always wrote. */
async function buildWord(images: OfficeImage[]): Promise<Uint8Array> {
  const blocks = images.map((image, i) => {
    checkPng(image.png);
    const { widthIn, heightIn } = fittedInches(image, 6.5, 9);
    return { n: i + 1, title: escapeXml(image.title), cx: emu(widthIn), cy: emu(heightIn) };
  });
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${blocks.map((b) => `<Override PartName="/word/media/image${b.n}.png" ContentType="image/png"/>`).join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${blocks.map((b) => `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">${b.title}</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline><wp:extent cx="${b.cx}" cy="${b.cy}"/><wp:docPr id="${b.n}" name="Graph"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${b.n}" name="Graph"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${b.n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${b.cx}" cy="${b.cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`).join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${blocks.map((b) => `<Relationship Id="rId${b.n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${b.n}.png"/>`).join("")}</Relationships>`,
  );
  for (const [i, image] of images.entries()) zip.file(`word/media/image${i + 1}.png`, image.png);
  return zip.generateAsync({ type: "uint8array" });
}

/** A .pptx: one 13.333×7.5 in slide per graph, the title in a textbox at
 *  the top and the image centred in the 12.333×6 in area below it.
 *  PowerPoint insists on a slide master, a layout and a theme, so the
 *  deck carries minimal versions of all three — a slide alone is not a
 *  deck it will open. One image builds exactly the one-slide deck
 *  `buildOfficeDocument` always wrote. */
async function buildPowerPoint(images: OfficeImage[]): Promise<Uint8Array> {
  const slides = images.map((image, i) => {
    checkPng(image.png);
    const { widthIn, heightIn } = fittedInches(image, 12.333, 6);
    const cx = emu(widthIn);
    const cy = emu(heightIn);
    // Centred in the image area (0.5 in side margins, 1 in below the title).
    const x = emu((13.333 - widthIn) / 2);
    const y = emu(1 + (6 - heightIn) / 2);
    return { n: i + 1, title: escapeXml(image.title), cx, cy, x, y };
  });
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((s) => `<Override PartName="/ppt/slides/slide${s.n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}${slides.map((s) => `<Override PartName="/ppt/media/image${s.n}.png" ContentType="image/png"/>`).join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((s) => `<p:sldId id="${255 + s.n}" r:id="rId${1 + s.n}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((s) => `<Relationship Id="rId${1 + s.n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${s.n}.xml"/>`).join("")}</Relationships>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/><a:chOff x="0" y="0"/><a:chExt cx="12192000" cy="6858000"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr algn="l"><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr algn="l"><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/><a:chOff x="0" y="0"/><a:chExt cx="12192000" cy="6858000"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/theme/theme1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
  );
  for (const s of slides) {
    zip.file(
      `ppt/slides/slide${s.n}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/><a:chOff x="0" y="0"/><a:chExt cx="12192000" cy="6858000"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="228600"/><a:ext cx="11277600" cy="457200"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="2400" b="1"/><a:t>${s.title}</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:nvPicPr><p:cNvPr id="3" name="Graph"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${s.x}" y="${s.y}"/><a:ext cx="${s.cx}" cy="${s.cy}"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    );
    zip.file(
      `ppt/slides/_rels/slide${s.n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${s.n}.png"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    );
    zip.file(`ppt/media/image${s.n}.png`, images[s.n - 1].png);
  }
  return zip.generateAsync({ type: "uint8array" });
}

/** The graph/layout as a real Word document or PowerPoint deck. Keynote
 *  has no file builder — a .key is written by Keynote itself, from the
 *  script the shell builds (see above); calling this with "keynote" is a
 *  caller bug, and it says so. */
export function buildOfficeDocument(target: OfficeTarget, image: OfficeImage): Promise<Uint8Array> {
  return buildOfficeDocumentMulti(target, [image]);
}

/** Several graphs/layouts as one Word document or PowerPoint deck — the
 *  gallery's Send, which places every selected graph in a single file
 *  instead of one file each. Word holds each graph under its own title;
 *  PowerPoint gives each graph its own slide. Keynote has no file
 *  builder (see above); an empty list has nothing to place. */
export function buildOfficeDocumentMulti(target: OfficeTarget, images: OfficeImage[]): Promise<Uint8Array> {
  if (target === "keynote")
    throw new Error("Send to Keynote builds the presentation in Keynote itself (macOS), not as a file — use handoffPngToKeynote.");
  if (images.length === 0) throw new Error("Office export needs at least one image.");
  return target === "word" ? buildWord(images) : buildPowerPoint(images);
}

// ── Send to Keynote (seq 217) ───────────────────────────────────────────
// Prism's mechanism, not a file format: AppleScript tells Keynote to make
// a presentation, add a slide with the title and the graph image, and save
// it as a .key. The script is pure text — the suite pins its shape — and
// the shell builds the same text itself from the values the page passes
// (src-tauri/src/main.rs, `build_keynote_script` + `send_to_keynote`)
// only on macOS, where osascript and Keynote exist. The page never hands
// the shell a script string (BUG-REPORT Round 2 Issue 1). Unverified on
// a real Mac in this lane: the Linux container cannot run Keynote, so the
// Mac proof batch owns the end-to-end check (script text, image
// placement, save).

/** Points per inch — Keynote sizes and positions are in points. */
const PT_PER_INCH = 72;

/** An image's size in points at its physical size (pixels / DPI × 72). */
export function keynoteSizePoints(widthPx: number, heightPx: number, dpi: number): { widthPt: number; heightPt: number } {
  if (!(widthPx > 0 && heightPx > 0)) throw new Error("Send to Keynote needs a positive image size.");
  if (!(dpi > 0)) throw new Error("Send to Keynote needs a positive DPI.");
  return { widthPt: (widthPx / dpi) * PT_PER_INCH, heightPt: (heightPx / dpi) * PT_PER_INCH };
}

export interface KeynoteScriptInput {
  /** Absolute path of the PNG file Keynote should place (a temp file the caller wrote). */
  pngPath: string;
  /** Absolute path the .key presentation should be saved to. */
  outPath: string;
  /** The graph or figure title, shown above the image. */
  title: string;
  /** The image's physical size in points (see `keynoteSizePoints`). */
  widthPt: number;
  heightPt: number;
}

/** An AppleScript string literal: backslashes and quotes escaped, line
 *  breaks flattened — a literal line break inside "..." is a syntax
 *  error in AppleScript, and a title is one line on the slide anyway. */
function appleScriptString(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`;
}

/** A script number: integers bare, fractions to two decimals — never
 *  locale-formatted, never scientific. */
function appleScriptNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
}

/** The AppleScript that makes the Keynote presentation: a new document,
 *  its first slide carrying the title as a text item at the top and the
 *  PNG centred below it at its physical size (fitted inside the slide,
 *  never cropped), saved to `outPath`. The slide size is read from the
 *  document itself, so any theme — widescreen or 4:3 — lays out right.
 *  Keynote stays open on the new presentation, as Prism leaves it: the
 *  user continues there. This is the suite-pinned shape reference for
 *  the identical script the shell builds itself
 *  (`build_keynote_script` in src-tauri/src/main.rs) — the page never
 *  sends this text to the shell (BUG-REPORT Round 2 Issue 1). No font
 *  styling is set — Keynote's default text item — because the script
 *  dictionary's text styling was not verified against a real Keynote in
 *  this lane; the Mac proof batch may add it. */
export function buildKeynoteScript(input: KeynoteScriptInput): string {
  const { pngPath, outPath, title, widthPt, heightPt } = input;
  if (!(widthPt > 0 && heightPt > 0)) throw new Error("Send to Keynote needs a positive image size.");
  return [
    'tell application "Keynote"',
    "\tactivate",
    `\tset pngFile to POSIX file ${appleScriptString(pngPath)}`,
    `\tset outFile to POSIX file ${appleScriptString(outPath)}`,
    "\tset doc to make new document",
    "\tset slideW to width of doc",
    "\tset slideH to height of doc",
    "\tset mySlide to slide 1 of doc",
    `\tset imgW to ${appleScriptNumber(widthPt)}`,
    `\tset imgH to ${appleScriptNumber(heightPt)}`,
    "\tset maxW to slideW - 72",
    "\tset maxH to slideH - 108",
    "\tif imgW > maxW then",
    "\t\tset imgH to imgH * maxW / imgW",
    "\t\tset imgW to maxW",
    "\tend if",
    "\tif imgH > maxH then",
    "\t\tset imgW to imgW * maxH / imgH",
    "\t\tset imgH to maxH",
    "\tend if",
    "\ttell mySlide",
    `\t\tset titleBox to make new text item with properties {object text: ${appleScriptString(title)}}`,
    "\t\tset position of titleBox to {36, 18}",
    "\t\tset width of titleBox to slideW - 72",
    "\t\tset height of titleBox to 36",
    "\t\tset newImage to make new image with properties {file: pngFile}",
    "\t\tset position of newImage to {(slideW - imgW) / 2, 72 + (maxH - imgH) / 2}",
    "\t\tset width of newImage to imgW",
    "\t\tset height of newImage to imgH",
    "\tend tell",
    "\tsave doc in outFile",
    "end tell",
  ].join("\n");
}
