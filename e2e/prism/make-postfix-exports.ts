// Generate post-fix .prism + .pzfx exports from the writers on THIS branch,
// so pin-writer-fix.py can be demonstrated PASS without a build or Prism.
// Same synthetic project shape as the W11 check in tests/prism-write.ts
// (one table per type) — the writers are pure TS, no app needed.
//
//   npx tsx e2e/prism/make-postfix-exports.ts --out-dir <dir>
//   python3 e2e/prism/pin-writer-fix.py <dir>   # -> ALL PASS
//
// Pre-fix FAIL counterpart: the Nov 13 qa roundtrip files
// (~/workspace/helix/qa/roundtrip-*.prism, Titer 1.0.7) and any 1.6.0-era
// .pzfx export lack the markers — pin-writer-fix.py FAILs on them.
import { writeFileSync, mkdirSync } from "node:fs";
import { writePrism } from "../../src/lib/prism-write";
import { writePzfx } from "../../src/lib/pzfx-write";

const outDir = process.argv.includes("--out-dir")
  ? process.argv[process.argv.indexOf("--out-dir") + 1]
  : "e2e/out/prism-pin";

const project = {
  nodes: {
    t_col: {
      id: "t_col",
      type: "table",
      name: "Col",
      parentId: null,
      tableType: "column",
      data: { columns: ["Title", "A", "B"], rows: [[null, "1", "2"]] },
    },
    t_xy: {
      id: "t_xy",
      type: "table",
      name: "XY",
      parentId: null,
      tableType: "xy",
      data: { columns: ["Title", "X", "Y_1", "Y_2"], rows: [[null, "0.1", "10", "11"]] },
    },
    t_surv: {
      id: "t_surv",
      type: "table",
      name: "Surv",
      parentId: null,
      tableType: "survival",
      data: { columns: ["Title", "Time", "GrpA", "GrpB"], rows: [[null, "0", "100", "90"]] },
    },
    t_grouped: {
      id: "t_grouped",
      type: "table",
      name: "Grouped",
      parentId: null,
      tableType: "grouped",
      data: {
        columns: ["Title", "G1:Y1", "G1:Y2", "G2:Y1", "G2:Y2"],
        rows: [[null, "1", "2", "3", "4"]],
      },
    },
    t_cont: {
      id: "t_cont",
      type: "table",
      name: "Cont",
      parentId: null,
      tableType: "contingency",
      data: { columns: ["Title", "A", "B"], rows: [[null, "5", "6"]] },
    },
  },
  rootOrder: ["t_col", "t_xy", "t_surv", "t_grouped", "t_cont"],
  childOrder: { t_col: [], t_xy: [], t_surv: [], t_grouped: [], t_cont: [] },
  activeNodeId: "t_col",
};

const prism = await writePrism(project as never, "1.6.2");
const pzfx = writePzfx(project as never, "1.6.2");
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/pin-demo.prism`, prism.bytes);
writeFileSync(`${outDir}/pin-demo.pzfx`, pzfx.bytes);
console.log(`wrote ${outDir}/pin-demo.prism (${prism.bytes.length} B)`);
console.log(`wrote ${outDir}/pin-demo.pzfx (${pzfx.bytes.length} B)`);
console.log(`prism report: tables=${prism.report.tables.join(", ")}`);
console.log(`pzfx report: tables=${pzfx.report.tables.join(", ")}`);
