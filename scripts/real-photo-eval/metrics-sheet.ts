/**
 * Scalp metrics for every photo of a view in a manifest, as the app would
 * compute them, printed as a table and written to <out>/metrics.json.
 *
 *   bun run scripts/real-photo-eval/metrics-sheet.ts .model-eval/hoff [view]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeScalpMetrics } from "../../src/lib/scalp/metrics";
import { readRgb, resizeRgb } from "./images";

const root = process.argv[2] ?? ".model-eval/hoff";
const view = process.argv[3] ?? "crown";
const WIDTH = 900;
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const photos = manifest.photos.filter((p: { view: string }) => p.view === view);
mkdirSync(join(root, "metrics"), { recursive: true });
const rows: Record<string, unknown>[] = [];
const one = (v: number | null) => (v === null ? "–" : v.toFixed(1));
console.log("file             hair    scale  exp%  patch  crown  ring  ratio  typ_mm  ms");
for (const p of photos) {
  const rgb = resizeRgb(readRgb(join(root, "images", p.file)), WIDTH);
  const t0 = Date.now();
  const { metrics: m } = computeScalpMetrics(rgb, p.hair_length);
  const ms = Date.now() - t0;
  rows.push({ file: p.file, ...m, ms });
  console.log(
    `${p.file.slice(0, 15)}  ${p.hair_length.padEnd(6)}  ${m.scaleKnown ? "known" : "guess"}  ${(m.exposure * 100).toFixed(0).padStart(3)}%  ${m.patchCm2.toFixed(0).padStart(4)}   ${one(m.crown.density).padStart(5)} ${one(m.ring.density).padStart(5)}  ${m.crownToRing === null ? "  –  " : m.crownToRing.toFixed(2).padStart(5)}  ${m.typicalLengthMm === null ? "  –" : m.typicalLengthMm.toFixed(1).padStart(4)}  ${ms}`,
  );
}
writeFileSync(join(root, "metrics", "metrics.json"), JSON.stringify(rows, null, 1));
