// Builds the bundled marketplace fixtures: the hello-analysis plugin as
// versioned zips + the sample index that lists them (with real sha256
// hashes). Run: `node scripts/build-marketplace-fixture.mjs` — it rewrites
// the zips AND sample-index.json together, so the hashes never drift.
// Zips are byte-deterministic (fixed file dates, STORE compression).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import JSZip from "jszip";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "src", "marketplace", "fixtures");
const SOURCE = join(FIXTURES, "hello-analysis");
const FIXED_DATE = new Date("2026-11-24T00:00:00Z");
const RAW_BASE = "https://raw.githubusercontent.com/smitpatel316/titer-marketplace/main/plugins/example.hello-analysis";

const pluginJson = JSON.parse(readFileSync(join(SOURCE, "plugin.json"), "utf8"));
const readme = readFileSync(join(SOURCE, "README.md"), "utf8");

async function buildZip(version) {
  const manifest = { ...pluginJson, version };
  const zip = new JSZip();
  zip.file("plugin.json", `${JSON.stringify(manifest, null, 2)}\n`, { date: FIXED_DATE });
  zip.file("README.md", readme, { date: FIXED_DATE });
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

const versions = [
  {
    version: "1.1.0",
    publishedAt: "2026-11-20T10:00:00Z",
    changelog: "Adds the hello-scaled-mean analysis (pure TypeScript compute).",
  },
  { version: "1.0.0", publishedAt: "2026-11-10T10:00:00Z", changelog: "First release." },
];

const entries = [];
for (const v of versions) {
  const bytes = await buildZip(v.version);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = `hello-analysis-${v.version}.zip`;
  writeFileSync(join(FIXTURES, file), bytes);
  entries.push({
    version: v.version,
    publishedAt: v.publishedAt,
    changelog: v.changelog,
    downloadUrl: `${RAW_BASE}/${v.version}/${file}`,
    sha256,
    bundledFile: file,
  });
  console.log(`${file}: sha256 ${sha256}`);
}

const [current] = entries;
const index = {
  formatVersion: 1,
  updatedAt: "2026-11-24T00:00:00Z",
  listings: [
    {
      id: pluginJson.id,
      name: pluginJson.name,
      version: current.version,
      apiVersion: pluginJson.apiVersion,
      author: pluginJson.author,
      license: pluginJson.license,
      description: pluginJson.description,
      downloadUrl: current.downloadUrl,
      sha256: current.sha256,
      readme: `${RAW_BASE}/${current.version}/README.md`,
      screenshots: [],
      bundled: true,
      bundledFile: current.bundledFile,
      versions: entries,
    },
  ],
};
writeFileSync(join(FIXTURES, "sample-index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log("sample-index.json written");
