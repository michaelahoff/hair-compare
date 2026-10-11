/**
 * Run the head-aware aligner (`alignHeads`) on every pair of one view in a
 * manifest, score the turn against the hand landmarks, and write overlay
 * sheets plus results.json (same shape as align-baseline).
 *
 *   bun run scripts/real-photo-eval/align-next.ts .model-eval/hoff [out] [view]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { alignHeads, headFeatures } from "../../src/lib/alignment/head-align";
import { readRgb, resizeRgb, writeJpeg } from "./images";
import { overlaySheet } from "./overlay";
import { loadTruth, pairError } from "./ground-truth";

const root = process.argv[2] ?? ".model-eval/hoff";
const out = process.argv[3] ?? join(root, "next");
const view = process.argv[4] ?? "crown";
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const photos = manifest.photos.filter((p: { view: string }) => p.view === view);
const truth = loadTruth(root);

const feats = new Map<string, ReturnType<typeof headFeatures>>();
const shows = new Map<string, ReturnType<typeof resizeRgb>>();
const t0 = Date.now();
for (const p of photos) {
  const rgb = readRgb(join(root, "images", p.file));
  const small = resizeRgb(rgb, 768);
  feats.set(p.file, headFeatures(small));
  shows.set(p.file, resizeRgb(small, 300));
}
console.log(`features for ${photos.length} photos in ${Date.now() - t0}ms`);

const rows: Record<string, unknown>[] = [];
let turnRight = 0;
let turnRightTop2 = 0;
let flagged = 0;
let flaggedWrong = 0;
for (let i = 0; i < photos.length; i++)
  for (let j = i + 1; j < photos.length; j++) {
    const a = photos[i].file;
    const b = photos[j].file;
    const t1 = Date.now();
    const r = alignHeads(feats.get(a)!.levels, feats.get(b)!.levels);
    const ms = Date.now() - t1;
    const pa = truth.poses[a];
    const pb = truth.poses[b];
    let err: ReturnType<typeof pairError> | null = null;
    let err2: ReturnType<typeof pairError> | null = null;
    if (pa && pb) {
      err = pairError(r.transform, pa, pb, truth.marks[a], truth.marks[b], truth.sizes);
      if (r.alternatives[1])
        err2 = pairError(r.alternatives[1].transform, pa, pb, truth.marks[a], truth.marks[b], truth.sizes);
      const right = err.rotationErr < 30;
      if (right) turnRight++;
      if (right || (err2 && err2.rotationErr < 30)) turnRightTop2++;
      if (r.ambiguous) {
        flagged++;
        if (!right) flaggedWrong++;
      }
    }
    const row = {
      ref: a,
      target: b,
      score: Number(r.score.toFixed(3)),
      accepted: r.score >= 0.3,
      ambiguous: r.ambiguous,
      runnerUp: r.alternatives[1] ? Number(r.alternatives[1].score.toFixed(3)) : null,
      rotationDeg: Number(((r.transform.rotation * 180) / Math.PI).toFixed(1)),
      scale: Number(r.transform.scale.toFixed(3)),
      tx: Number(r.transform.tx.toFixed(3)),
      ty: Number(r.transform.ty.toFixed(3)),
      rotationErr: err ? Number(err.rotationErr.toFixed(0)) : null,
      patchMiss: err ? Number((err.patchMiss * 100).toFixed(0)) : null,
      ms,
    };
    rows.push(row);
    console.log(
      `${a.slice(9, 15)}->${b.slice(9, 15)} score ${row.score} (2nd ${row.runnerUp}) rot ${row.rotationDeg} scale ${row.scale} rotErr ${row.rotationErr}° miss ${row.patchMiss}% ${r.ambiguous ? "AMBIGUOUS" : ""} ${ms}ms`,
    );
    const sheet = overlaySheet(shows.get(b)!, shows.get(a)!, r.transform);
    writeJpeg(
      join(out, `${a.slice(0, 15)}__${b.slice(0, 15)}_${row.rotationErr !== null && row.rotationErr < 30 ? "ok" : "bad"}_${row.score}${r.ambiguous ? "_amb" : ""}.jpg`),
      sheet,
      80,
    );
    writeFileSync(join(out, "results.json"), JSON.stringify(rows, null, 1));
  }
console.log(
  `${rows.length} pairs: turn right ${turnRight}, right within top 2 basins ${turnRightTop2}, flagged ambiguous ${flagged} (of which wrong ${flaggedWrong}); ${((Date.now() - t0) / 1000).toFixed(0)}s`,
);
