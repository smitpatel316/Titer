// BUG-4 + BUG-7 repro pin: the .pzfx reader must preserve titles EXACTLY —
// no trimming of trailing spaces, no dedup-renaming ("MitoFactory" -> "MitoFactory 2").
// Ground truth is the exported .pzfx FILE bytes (verified by grep) and the
// original .prism import (convertPrism preserves titles exactly).
//
// Usage (repo root): npx tsx work/repro-bug4-7.ts
// Exits 0 when every check passes, 1 otherwise.
import { readFile } from "node:fs/promises";
import { parsePzfx } from "../src/lib/pzfx";
import { convertPrism } from "../src/lib/prism";

const RUNS = "/home/hatch/workspace/.helix-owed-items/battery-full-loop/work/runs";
const CORPUS = "/home/hatch/workspace/helix/test-corpus";

let failures = 0;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label} — ${detail}`);
  if (!ok) failures++;
};

const count = (xs: (string | null | undefined)[], v: string) => xs.filter((x) => x === v).length;

async function pzfxTable(pzfxPath: string, table: string) {
  const text = await readFile(pzfxPath, "utf-8");
  const parsed = parsePzfx(text);
  const node = Object.values(parsed.project.nodes).find((n: any) => n.name === table) as any;
  return { parsed, node: node ?? null };
}

async function prismTable(prismPath: string, table: string) {
  const buf = await readFile(prismPath);
  const converted = await convertPrism(buf, prismPath.split("/").pop()!);
  const node = Object.values(converted.project.nodes).find((n: any) => n.name === table) as any;
  return { converted, node: node ?? null };
}

async function main() {
  // 1. BUG-4 core: c2c12kd-transfer, table `C2C12 Post Copy-2` has TWO
  // columns named `MitoFactory`; the file holds `MitoFactory` 9x, no `MitoFactory 2`.
  {
    const pzfx = `${RUNS}/slice1/exports/c2c12kd-transfer-zenodo-15723625_prism/c2c12kd-transfer-zenodo-15723625.pzfx`;
    const { node } = await pzfxTable(pzfx, "C2C12 Post Copy-2");
    const cols: string[] = node?.data?.columns ?? [];
    check(
      "c2c12kd MitoFactory x2",
      count(cols, "MitoFactory") === 2 && !cols.includes("MitoFactory 2"),
      `columns=${JSON.stringify(cols)}`,
    );
    const orig = await prismTable(`${CORPUS}/c2c12kd-transfer-zenodo-15723625.prism`, "C2C12 Post Copy-2");
    const origCols: string[] = orig.node?.data?.columns ?? [];
    check(
      "c2c12kd orig-vs-pzfx columns identical",
      JSON.stringify(origCols) === JSON.stringify(cols),
      `orig=${JSON.stringify(origCols)} pzfx=${JSON.stringify(cols)}`,
    );
  }

  // 2. BUG-4 widened: dose-curve, table `NRBP1` — `0nM␣` x2, `300nM␣` x3,
  // all with trailing spaces; read-back was `0nM, 1nM, …, 300nM 2, 0nM 2, 300nM 3`.
  {
    const pzfx = `${RUNS}/slice2/exports/dose-curve-zenodo-15257821_prism/dose-curve-zenodo-15257821.pzfx`;
    const { node } = await pzfxTable(pzfx, "NRBP1");
    const cols: string[] = node?.data?.columns ?? [];
    check(
      "dose-curve NRBP1 trailing spaces + duplicates",
      count(cols, "0nM ") === 2 && count(cols, "300nM ") === 3 && !cols.some((c) => / \d+$/.test(c)),
      `columns=${JSON.stringify(cols)}`,
    );
    const orig = await prismTable(`${CORPUS}/dose-curve-zenodo-15257821.prism`, "NRBP1");
    const origCols: string[] = orig.node?.data?.columns ?? [];
    check(
      "dose-curve orig-vs-pzfx columns identical",
      JSON.stringify(origCols) === JSON.stringify(cols),
      `orig=${JSON.stringify(origCols)} pzfx=${JSON.stringify(cols)}`,
    );
  }

  // 3. BUG-7: dimensional-analysis, table `XY ` (trailing space); the file
  // holds `<Title>XY </Title>`, read-back was `XY`.
  {
    const pzfx = `${RUNS}/slice2/exports/dimensional-analysis-zenodo-8347134_prism/dimensional-analysis-zenodo-8347134.pzfx`;
    const { parsed } = await pzfxTable(pzfx, "XY ");
    check(
      "dimensional-analysis table `XY ` preserved",
      parsed.tables.includes("XY ") && !parsed.tables.includes("XY"),
      `tables=${JSON.stringify(parsed.tables)}`,
    );
    const orig = await prismTable(`${CORPUS}/dimensional-analysis-zenodo-8347134.prism`, "XY ");
    check(
      "dimensional-analysis orig table `XY ` exists",
      orig.node !== null,
      orig.node ? "found" : "orig table `XY ` missing (converter?)",
    );
  }

  // 4. BUG-4 widened: fig-7d, grouped tables — group `NRBP1 WT␣` trimmed,
  // AND row title `Control␣` trimmed (a differing VALUE cell).
  {
    const pzfx = `${RUNS}/slice2/exports/fig-7d-zenodo-15257821_prism/fig-7d-zenodo-15257821.pzfx`;
    const { node } = await pzfxTable(pzfx, "pOSR1");
    const cols: string[] = node?.data?.columns ?? [];
    const rowTitles: (string | null)[] = (node?.data?.rows ?? []).map((r: any[]) => r[0]);
    check(
      "fig-7d group `NRBP1 WT ` preserved",
      cols.includes("NRBP1 WT :Y1"),
      `columns=${JSON.stringify(cols)}`,
    );
    check(
      "fig-7d row title `Control ` preserved",
      rowTitles.includes("Control ") && !rowTitles.includes("Control"),
      `rowTitles=${JSON.stringify(rowTitles)}`,
    );
  }

  // 5. BUG-4 widened: sup3b, table `Raw Data` (column) — TWO `Normalized`.
  {
    const pzfx = `${RUNS}/slice6/exports/sup3b-zenodo-16883557_prism/sup3b-zenodo-16883557.pzfx`;
    const { node } = await pzfxTable(pzfx, "Raw Data");
    const cols: string[] = node?.data?.columns ?? [];
    check(
      "sup3b Normalized x2",
      count(cols, "Normalized") === 2 && !cols.includes("Normalized 2"),
      `columns=${JSON.stringify(cols)}`,
    );
  }

  // 6. BUG-4 widened: elisa-standard-curves — four xy tables with `Y, Y, Y, Y`.
  {
    const pzfx = `${RUNS}/slice2/exports/elisa-standard-curves-zenodo-21038547_prism/elisa-standard-curves-zenodo-21038547.pzfx`;
    const text = await readFile(pzfx, "utf-8");
    const parsed = parsePzfx(text);
    const withFourY = parsed.tables.filter((t) => {
      const n: any = Object.values(parsed.project.nodes).find((x: any) => x.name === t);
      return count(n?.data?.columns ?? [], "Y") === 4;
    });
    check(
      "elisa `Y` x4 preserved on some table",
      withFourY.length > 0,
      `tables-with-Yx4=${JSON.stringify(withFourY)} tables=${JSON.stringify(parsed.tables)}`,
    );
  }

  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PIN ERROR", e);
  process.exit(1);
});
