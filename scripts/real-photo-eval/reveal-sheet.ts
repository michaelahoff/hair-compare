/**
 * The revealed view of a photo next to the original, as the app makes it,
 * plus the PNG data-URI size. bun run scripts/real-photo-eval/reveal-sheet.ts <dir> <file>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pngDataUri, revealRgb } from "../../src/lib/scalp/reveal";
import { computeScalpMetrics } from "../../src/lib/scalp/metrics";
import { tintLines } from "../../src/lib/scalp/reveal";
import { hstack, readRgb, resizeRgb, writeJpeg } from "./images";

const root = process.argv[2] ?? ".model-eval/hoff";
const file = process.argv[3] ?? "20261003_092142_14733.jpg";
const rgb = resizeRgb(readRgb(join(root, "images", file)), 720);
const t0 = Date.now();
const revealed = revealRgb(rgb);
const t1 = Date.now();
const uri = pngDataUri(revealed);
const t2 = Date.now();
const { maps } = computeScalpMetrics(resizeRgb(readRgb(join(root, "images", file)), 900), "short");
const t3 = Date.now();
const lines900 = tintLines(resizeRgb(readRgb(join(root, "images", file)), 900), maps.lines, [0, 220, 255], maps.region);
console.log(`reveal ${t1 - t0}ms, png ${t2 - t1}ms (${(uri.length / 1e6).toFixed(1)} MB data URI), metrics ${t3 - t2}ms`);
writeJpeg(join(root, "proto", "reveal-ts.jpg"), hstack([rgb, revealed, resizeRgb(lines900, 720)]), 85);
console.log("wrote", join(root, "proto", "reveal-ts.jpg"));
