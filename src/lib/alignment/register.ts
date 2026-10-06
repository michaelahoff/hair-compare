import {
  blur,
  downsample,
  gradientMagnitude,
  sampleBilinear,
  standardize,
  type GrayImage,
} from "./image";
import { IDENTITY, type Similarity } from "./transform";

export type AlignOptions = {
  /** Rotation search range, ± degrees. Top-down crown shots can be at any angle. */
  maxRotationDeg: number;
  minScale: number;
  maxScale: number;
  /** Translation search range, ± width-normalised units. */
  maxTranslation: number;
  /** Width of the coarsest pyramid level, where the exhaustive search runs. */
  coarseWidth: number;
};

export const DEFAULT_ALIGN_OPTIONS: AlignOptions = {
  maxRotationDeg: 180,
  minScale: 0.6,
  maxScale: 1.6,
  maxTranslation: 0.3,
  coarseWidth: 16,
};

export type AlignResult = {
  /** Maps reference coordinates to target coordinates. */
  transform: Similarity;
  /** Normalised cross-correlation of edge maps at the finest level, -1..1. */
  score: number;
};

const ROTATION_STEP_DEG = 10;
const SCALE_STEP = 1.15;
const MIN_OVERLAP = 0.35;
const CANDIDATES = 8;

/**
 * Estimate the similarity transform that maps `ref` onto `target`.
 *
 * Coarse-to-fine: an exhaustive rotation × scale × translation search on tiny
 * edge maps produces candidates, then a pattern search refines the best ones
 * at each finer pyramid level. Both images should be roughly the same working
 * width (~128px); larger inputs only cost time.
 */
export function align(
  ref: GrayImage,
  target: GrayImage,
  options: Partial<AlignOptions> = {},
): AlignResult {
  const opts = { ...DEFAULT_ALIGN_OPTIONS, ...options };
  const levels = Math.max(
    0,
    Math.floor(Math.log2(ref.width / opts.coarseWidth)),
  );
  const refPyramid = pyramid(ref, levels);
  const targetPyramid = pyramid(target, levels);

  let candidates = coarseSearch(
    refPyramid[levels],
    targetPyramid[levels],
    opts,
  ).map((transform) => ({
    transform,
    score: -Infinity,
  }));
  // Featureless photos have no candidates; return a rejected match, not undefined.
  if (!candidates.length) return { transform: { ...IDENTITY }, score: 0 };
  let rotationStep = (ROTATION_STEP_DEG / 2) * (Math.PI / 180);
  let logScaleStep = Math.log(SCALE_STEP) / 2;

  for (let level = levels; level >= 0; level--) {
    const r = refPyramid[level];
    const t = targetPyramid[level];
    candidates = candidates
      .map((c) =>
        refine(r, t, c.transform, { rotationStep, logScaleStep }, opts),
      )
      .sort((a, b) => b.score - a.score);
    // Fewer survivors at each finer (and more expensive) level.
    candidates = candidates.slice(0, Math.max(1, candidates.length >> 2));
    rotationStep /= 2;
    logScaleStep /= 2;
  }
  return candidates[0];
}

function features(img: GrayImage): GrayImage {
  return standardize(gradientMagnitude(blur(img, 1)));
}

/** Feature maps, finest first; index `levels` is the coarsest. */
function pyramid(img: GrayImage, levels: number): GrayImage[] {
  const out = [features(img)];
  let current = img;
  for (let i = 0; i < levels; i++) {
    current = downsample(current);
    out.push(features(current));
  }
  return out;
}

function coarseSearch(
  ref: GrayImage,
  target: GrayImage,
  opts: AlignOptions,
): Similarity[] {
  const { width: w, height: h } = ref;
  const rcx = (w - 1) / 2;
  const rcy = (h - 1) / 2;
  const tw = target.width;
  const tcx = (tw - 1) / 2;
  const tcy = (target.height - 1) / 2;
  const maxShift = Math.ceil(opts.maxTranslation * w);
  const minPixels = MIN_OVERLAP * w * h;
  const warped = new Float32Array(w * h);
  const mask = new Uint8Array(w * h);
  const found: { t: Similarity; score: number }[] = [];

  const rotations: number[] = [];
  const maxRot = Math.min(opts.maxRotationDeg, 180);
  for (let deg = -maxRot; deg <= maxRot + 1e-9; deg += ROTATION_STEP_DEG) {
    if (maxRot === 180 && deg === 180) continue; // same as -180
    rotations.push((deg * Math.PI) / 180);
  }
  const scales: number[] = [];
  for (let s = opts.minScale; s <= opts.maxScale * 1.0001; s *= SCALE_STEP)
    scales.push(s);

  for (const rotation of rotations) {
    for (const scale of scales) {
      // Warp the target into the reference frame (no translation yet).
      const a = Math.cos(rotation) * scale;
      const b = Math.sin(rotation) * scale;
      for (let y = 0; y < h; y++) {
        const v = (y - rcy) / w;
        for (let x = 0; x < w; x++) {
          const u = (x - rcx) / w;
          const value = sampleBilinear(
            target,
            (a * u - b * v) * tw + tcx,
            (b * u + a * v) * tw + tcy,
          );
          const i = y * w + x;
          mask[i] = Number.isNaN(value) ? 0 : 1;
          warped[i] = mask[i] ? value : 0;
        }
      }
      // Exhaustive integer shift d in the reference frame: ref(p) vs warped(p + d).
      for (let dy = -maxShift; dy <= maxShift; dy++) {
        const y0 = Math.max(0, -dy);
        const y1 = Math.min(h, h - dy);
        for (let dx = -maxShift; dx <= maxShift; dx++) {
          const x0 = Math.max(0, -dx);
          const x1 = Math.min(w, w - dx);
          let sab = 0;
          let saa = 0;
          let sbb = 0;
          let n = 0;
          for (let y = y0; y < y1; y++) {
            let i = y * w + x0;
            let j = (y + dy) * w + x0 + dx;
            for (let x = x0; x < x1; x++, i++, j++) {
              if (!mask[j]) continue;
              const ra = ref.data[i];
              const wb = warped[j];
              sab += ra * wb;
              saa += ra * ra;
              sbb += wb * wb;
              n++;
            }
          }
          if (n < minPixels || saa === 0 || sbb === 0) continue;
          const score = sab / Math.sqrt(saa * sbb);
          // t = s·R·d, expressed in normalised units.
          const du = dx / w;
          const dv = dy / w;
          found.push({
            t: { rotation, scale, tx: a * du - b * dv, ty: b * du + a * dv },
            score,
          });
        }
      }
    }
  }

  found.sort((p, q) => q.score - p.score);
  // Keep the best few that are not near-duplicates of one another.
  const picked: Similarity[] = [];
  for (const { t } of found) {
    const distinct = picked.every(
      (p) =>
        Math.abs(angleDiff(p.rotation, t.rotation)) >
          (ROTATION_STEP_DEG * 1.5 * Math.PI) / 180 ||
        Math.abs(Math.log(p.scale / t.scale)) > Math.log(SCALE_STEP) * 1.5 ||
        Math.hypot(p.tx - t.tx, p.ty - t.ty) > 3 / w,
    );
    if (distinct) picked.push(t);
    if (picked.length === CANDIDATES) break;
  }
  return picked;
}

/** Normalised cross-correlation of `ref` against `target` warped by `t`. */
export function ncc(ref: GrayImage, target: GrayImage, t: Similarity): number {
  const { width: w, height: h } = ref;
  const tw = target.width;
  const tcx = (tw - 1) / 2;
  const tcy = (target.height - 1) / 2;
  const rcx = (w - 1) / 2;
  const rcy = (h - 1) / 2;
  // Pixel-space affine map ref (x, y) -> target (X, Y).
  const a = Math.cos(t.rotation) * t.scale * (tw / w);
  const b = Math.sin(t.rotation) * t.scale * (tw / w);
  const ox = t.tx * tw + tcx - a * rcx + b * rcy;
  const oy = t.ty * tw + tcy - b * rcx - a * rcy;

  let sa = 0;
  let sb = 0;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    let X = ox - b * y;
    let Y = oy + a * y;
    for (let x = 0; x < w; x++, X += a, Y += b) {
      const tb = sampleBilinear(target, X, Y);
      if (Number.isNaN(tb)) continue;
      const ra = ref.data[y * w + x];
      sa += ra;
      sb += tb;
      sab += ra * tb;
      saa += ra * ra;
      sbb += tb * tb;
      n++;
    }
  }
  if (n < MIN_OVERLAP * w * h) return -1;
  const cov = sab - (sa * sb) / n;
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  if (va <= 0 || vb <= 0) return -1;
  return cov / Math.sqrt(va * vb);
}

function refine(
  ref: GrayImage,
  target: GrayImage,
  init: Similarity,
  steps: { rotationStep: number; logScaleStep: number },
  opts: AlignOptions,
): AlignResult {
  let best = init;
  let bestScore = ncc(ref, target, init);
  let translationStep = 1 / ref.width;
  let { rotationStep, logScaleStep } = steps;
  const minTranslationStep = 0.2 / ref.width;
  const minScale = opts.minScale / 1.2;
  const maxScale = opts.maxScale * 1.2;

  for (
    let iter = 0;
    iter < 300 && translationStep >= minTranslationStep;
    iter++
  ) {
    const moves: Similarity[] = [
      { ...best, tx: best.tx + translationStep },
      { ...best, tx: best.tx - translationStep },
      { ...best, ty: best.ty + translationStep },
      { ...best, ty: best.ty - translationStep },
      { ...best, rotation: best.rotation + rotationStep },
      { ...best, rotation: best.rotation - rotationStep },
      { ...best, scale: best.scale * Math.exp(logScaleStep) },
      { ...best, scale: best.scale * Math.exp(-logScaleStep) },
    ];
    let improved = false;
    for (const move of moves) {
      if (move.scale < minScale || move.scale > maxScale) continue;
      const score = ncc(ref, target, move);
      if (score > bestScore + 1e-7) {
        best = move;
        bestScore = score;
        improved = true;
      }
    }
    if (!improved) {
      translationStep /= 2;
      rotationStep /= 2;
      logScaleStep /= 2;
    }
  }
  return {
    transform: { ...best, rotation: angleDiff(best.rotation, 0) },
    score: bestScore,
  };
}

/** Signed difference a - b wrapped to (-π, π]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d <= -Math.PI) d += 2 * Math.PI;
  if (d > Math.PI) d -= 2 * Math.PI;
  return d;
}
