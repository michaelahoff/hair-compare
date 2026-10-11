/**
 * Hand-marked landmarks as a similarity per photo (canonical head → photo),
 * and the error of a pair's estimated transform against them.
 */
import { readFileSync } from "node:fs";
import {
  applySimilarity,
  invertSimilarity,
  type Similarity,
} from "../../src/lib/alignment/transform";
import { compose } from "../../src/lib/framing";

export type Marks = {
  patch: [number, number];
  neck: [number, number];
  left: [number, number] | null;
  right: [number, number] | null;
};
export type Pose = Similarity & { file: string; headWidth: number; widthKnown: boolean };

/** Percent of width/height → width-normalised, centre-origin units. */
export function pct(p: [number, number], size: { width: number; height: number }): [number, number] {
  return [
    ((p[0] / 100) * size.width - (size.width - 1) / 2) / size.width,
    ((p[1] / 100) * size.height - (size.height - 1) / 2) / size.width,
  ];
}

/**
 * Poses for every marked photo. Scale is the head width in width units; when
 * the head is cut off it is estimated from the patch-to-neck distance using
 * the median ratio over photos where both are known.
 */
export function poses(
  marks: Record<string, Marks>,
  sizes: Record<string, { width: number; height: number }>,
): Record<string, Pose> {
  const raw = Object.entries(marks).map(([file, m]) => {
    const size = sizes[file];
    const patch = pct(m.patch, size);
    const neck = pct(m.neck, size);
    const toNeck = Math.hypot(neck[0] - patch[0], neck[1] - patch[1]);
    const width =
      m.left && m.right
        ? Math.hypot(...(() => {
            const l = pct(m.left, size);
            const r = pct(m.right, size);
            return [r[0] - l[0], r[1] - l[1]] as [number, number];
          })())
        : null;
    return { file, patch, neck, toNeck, width };
  });
  const ratios = raw.filter((r) => r.width).map((r) => r.width! / r.toNeck).sort((a, b) => a - b);
  const ratio = ratios[ratios.length >> 1];
  return Object.fromEntries(
    raw.map((r) => {
      const headWidth = r.width ?? r.toNeck * ratio;
      // Canonical frame: patch at the origin, neck straight down (+v), head width 1.
      const rotation = Math.atan2(r.neck[1] - r.patch[1], r.neck[0] - r.patch[0]) - Math.PI / 2;
      return [
        r.file,
        { file: r.file, tx: r.patch[0], ty: r.patch[1], rotation, scale: headWidth, headWidth, widthKnown: Boolean(r.width) },
      ];
    }),
  );
}

/** The transform from photo a's units to photo b's, from their poses. */
export function truth(a: Pose, b: Pose): Similarity {
  return compose(b, invertSimilarity(a));
}

export type PairError = {
  /** Where a's patch centre lands in b, as a share of b's head width. */
  patchMiss: number;
  /** Degrees, wrapped to [0, 180]. */
  rotationErr: number;
  /** log2 ratio of estimated to true scale. */
  scaleErr: number;
};

export function pairError(est: Similarity, a: Pose, b: Pose, aMarks: Marks, bMarks: Marks, sizes: Record<string, { width: number; height: number }>): PairError {
  const [px, py] = applySimilarity(est, ...pct(aMarks.patch, sizes[a.file]));
  const [bx, by] = pct(bMarks.patch, sizes[b.file]);
  const t = truth(a, b);
  let rot = ((est.rotation - t.rotation) * 180) / Math.PI;
  rot = Math.abs(((rot + 540) % 360) - 180);
  return {
    patchMiss: Math.hypot(px - bx, py - by) / b.headWidth,
    rotationErr: rot,
    scaleErr: Math.log2(est.scale / t.scale),
  };
}

/** A match is "right" when the patch lands within 12% of the head width, the turn is within 15° and the scale within 20%. */
export function isRight(e: PairError) {
  return e.patchMiss < 0.12 && e.rotationErr < 15 && Math.abs(e.scaleErr) < Math.log2(1.2);
}

export function loadTruth(root: string, view = "crown") {
  const landmarks = JSON.parse(readFileSync(`${root}/landmarks.json`, "utf8"));
  const exif = JSON.parse(readFileSync(`${root}/exif.json`, "utf8")) as { file: string; width: number; height: number }[];
  const sizes = Object.fromEntries(exif.map((e) => [e.file, { width: e.width, height: e.height }]));
  const marks = landmarks[view] as Record<string, Marks>;
  return { marks, sizes, poses: poses(marks, sizes) };
}
