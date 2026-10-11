/**
 * Run the app's on-device aligner (`align`, 96 px wide greyscale, as
 * `alignPhotos` does) on every pair of crown photos in a manifest and write
 * scores plus overlay sheets for inspection.
 *
 *   bun run scripts/real-photo-eval/align-baseline.ts .model-eval/hoff [out-dir]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { align, MIN_MATCH } from "../../src/lib/alignment";
import { grayAt, readRgb, resizeRgb, writeJpeg } from "./images";
import { overlaySheet } from "./overlay";

const root = process.argv[2] ?? ".model-eval/hoff";
const out = process.argv[3] ?? join(root, "baseline");
const view = process.argv[4] ?? "crown";
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const photos = manifest.photos.filter((p: { view: string }) => p.view === view);
const WORK = 96;
const SHOW = 300;

const grays = new Map<string, ReturnType<typeof grayAt>>();
const shows = new Map<string, ReturnType<typeof resizeRgb>>();
for (const p of photos) {
  const path = join(root, "images", p.file);
  grays.set(p.file, grayAt(path, WORK));
  shows.set(p.file, resizeRgb(readRgb(path), SHOW));
}
const rows: Record<string, unknown>[] = [];
const started = Date.now();
for (let i = 0; i < photos.length; i++) {
  for (let j = i + 1; j < photos.length; j++) {
    const a = photos[i];
    const b = photos[j];
    const t0 = Date.now();
    const result = align(grays.get(a.file)!, grays.get(b.file)!);
    const ms = Date.now() - t0;
    const row = {
      ref: a.file,
      target: b.file,
      score: Number(result.score.toFixed(3)),
      accepted: result.score >= MIN_MATCH,
      rotationDeg: Number(((result.transform.rotation * 180) / Math.PI).toFixed(1)),
      scale: Number(result.transform.scale.toFixed(3)),
      tx: Number(result.transform.tx.toFixed(3)),
      ty: Number(result.transform.ty.toFixed(3)),
      ms,
    };
    rows.push(row);
    console.log(
      `${a.file.slice(0, 15)} -> ${b.file.slice(0, 15)} score ${row.score} rot ${row.rotationDeg} scale ${row.scale} t (${row.tx}, ${row.ty}) ${ms}ms ${row.accepted ? "ACCEPT" : "reject"}`,
    );
    const sheet = overlaySheet(shows.get(b.file)!, shows.get(a.file)!, result.transform);
    writeJpeg(
      join(out, `${a.file.slice(0, 15)}__${b.file.slice(0, 15)}_${row.accepted ? "acc" : "rej"}_${row.score}.jpg`),
      sheet,
      80,
    );
  }
}
writeFileSync(join(out, "results.json"), JSON.stringify(rows, null, 1));
const accepted = rows.filter((r) => r.accepted).length;
console.log(
  `${rows.length} pairs, ${accepted} accepted (score >= ${MIN_MATCH}), ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
