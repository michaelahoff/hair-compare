/**
 * Lining two scalp photos up by their heads rather than by whatever is
 * behind them. Floor tiles, collars and mirror cabinets carry most of the
 * edges in a crown photo and dragged the plain registration off the head on
 * real photos, so here everything outside the head mask is ignored, and two
 * channels are matched at once: the smoothed skin map (where the scalp
 * shows) and the fine edges inside the head.
 *
 * The search is the same coarse-to-fine pattern search as `register.ts`.
 * A round head and a roundish patch leave the turn ambiguous, so the best
 * transform in each quarter-turn basin is also refined and returned: when
 * the runner-up is close, the caller should let the user pick.
 *
 * Pure functions on typed arrays: no React or Expo imports.
 */
import { createImage, gradientMagnitude, type GrayImage } from "./image";
import { IDENTITY, type Similarity } from "./transform";
import { erode, gaussianBlur, resizeArea, type Mask } from "../scalp/image-ops";
import { headMask } from "../scalp/head-mask";
import { lumaOf, resizeRgb, type RgbImage } from "../scalp/rgb";
import { runSteps, runStepsAsync, type Steps } from "../steps";

/** One photo's head, skin and edge channels at one working width. */
export type HeadFeatures = {
  width: number;
  height: number;
  /** 1 inside the head. */
  mask: Uint8Array;
  /** Smoothed skin map, standardised inside the mask, 0 outside. */
  skin: Float32Array;
  /** Fine edges, standardised inside the eroded mask, 0 outside. */
  edge: Float32Array;
  /** 1 where `edge` counts: a little inside the head's outline. */
  edgeMask: Uint8Array;
};

/** Working widths, finest first. The coarse search runs at the last. */
export const HEAD_LEVELS = [192, 96, 48, 24];
/** Width the head is found at; masks are resized from here. */
export const MASK_WIDTH = 256;

export type HeadAlignOptions = {
  /** Weight of the skin channel; the rest goes to edges. */
  skinWeight: number;
  minScale: number;
  maxScale: number;
  /** Translation search range at the coarsest level, ± width-normalised. */
  maxTranslation: number;
  rotationStepDeg: number;
  scaleStep: number;
  candidates: number;
  /** A runner-up basin within this of the best score makes the turn ambiguous. */
  ambiguityMargin: number;
};

export const DEFAULT_HEAD_ALIGN: HeadAlignOptions = {
  skinWeight: 0.5,
  minScale: 0.62,
  maxScale: 1.6,
  maxTranslation: 0.25,
  rotationStepDeg: 15,
  scaleStep: 1.2,
  candidates: 8,
  ambiguityMargin: 0.08,
};

/** Share of the reference head both heads must cover for a score to count. */
const MIN_OVERLAP = 0.3;

export type HeadAlignResult = {
  transform: Similarity;
  /** Combined masked correlation, -1..1. */
  score: number;
  /** The best transform in each quarter-turn basin, best first (includes `transform`). */
  alternatives: { transform: Similarity; score: number }[];
  /** True when another basin scores within `ambiguityMargin` of the best. */
  ambiguous: boolean;
  /** Share of the reference head the target covers under `transform`. */
  overlap: number;
};

/** Zero-mean, unit-variance inside the mask; 0 outside. */
function standardizeIn(img: GrayImage, mask: Uint8Array): Float32Array {
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    n++;
    sum += img.data[i];
    sumSq += img.data[i] * img.data[i];
  }
  const out = new Float32Array(mask.length);
  if (n < 10) return out;
  const mean = sum / n;
  const std = Math.sqrt(Math.max(sumSq / n - mean * mean, 1e-12));
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) out[i] = (img.data[i] - mean) / std;
  return out;
}

/** A 0..1 mask image resized by area averaging, back to 0/1. */
function resizeMask(mask: Mask, width: number): Mask {
  const img = createImage(mask.width, mask.height);
  for (let i = 0; i < img.data.length; i++) img.data[i] = mask.data[i];
  const small = resizeArea(img, width);
  const out = new Uint8Array(small.data.length);
  for (let i = 0; i < out.length; i++) out[i] = small.data[i] > 0.5 ? 1 : 0;
  return { width: small.width, height: small.height, data: out };
}

/**
 * Features at one width from a photo's luma, skin map and head mask, all
 * at any (equal) size: they are resized here.
 */
export function headFeaturesAt(
  luma: GrayImage,
  skin: GrayImage,
  mask: Mask,
  width: number,
): HeadFeatures {
  const s = width / 256;
  const m = resizeMask(mask, width);
  const skinSmall = resizeArea(skin, width);
  const lumaSmall = resizeArea(luma, width);
  const skinBlur = gaussianBlur(skinSmall, Math.max(1, 4 * s));
  const edges = gradientMagnitude(gaussianBlur(lumaSmall, Math.max(0.8, s)));
  const inner = erode(m, Math.max(1, Math.round(2.5 * s)));
  return {
    width: m.width,
    height: m.height,
    mask: m.data,
    skin: standardizeIn(skinBlur, m.data),
    edge: standardizeIn(edges, inner.data),
    edgeMask: inner.data,
  };
}

/**
 * Every level's features for a photo. The head is found at `MASK_WIDTH`;
 * luma is read at the finest level's width so edges keep their detail.
 */
export function headFeatures(
  rgb: RgbImage,
  levels: number[] = HEAD_LEVELS,
): { levels: HeadFeatures[]; mask: Mask; skin: GrayImage } {
  const base = resizeRgb(rgb, MASK_WIDTH);
  const { mask, skin } = headMask(base);
  const fine = resizeRgb(rgb, levels[0]);
  const luma = lumaOf(fine);
  for (let i = 0; i < luma.data.length; i++) luma.data[i] /= 255;
  // Mask and skin are at MASK_WIDTH; luma at the finest level.
  return {
    levels: levels.map((w) => headFeaturesAt(luma, skin, mask, w)),
    mask,
    skin,
  };
}

/** Pixel-space affine map ref (x, y) -> target (X, Y) for `t`. */
function pixelMap(ref: HeadFeatures, target: HeadFeatures, t: Similarity) {
  const w = ref.width;
  const tw = target.width;
  const a = Math.cos(t.rotation) * t.scale * (tw / w);
  const b = Math.sin(t.rotation) * t.scale * (tw / w);
  const rcx = (w - 1) / 2;
  const rcy = (ref.height - 1) / 2;
  const tcx = (tw - 1) / 2;
  const tcy = (target.height - 1) / 2;
  return {
    a,
    b,
    ox: t.tx * tw + tcx - a * rcx + b * rcy,
    oy: t.ty * tw + tcy - b * rcx - a * rcy,
  };
}

/** Bilinear sample of a channel; NaN outside. */
function sample(
  data: Float32Array | Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return NaN;
  const x0 = Math.min(Math.floor(x), width - 2);
  const y0 = Math.min(Math.floor(y), height - 2);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * width + x0;
  const top = data[i] + (data[i + 1] - data[i]) * fx;
  const bottom = data[i + width] + (data[i + width + 1] - data[i + width]) * fx;
  return top + (bottom - top) * fy;
}

/** Running sums for a masked normalised cross-correlation. */
class Corr {
  n = 0;
  sa = 0;
  sb = 0;
  sab = 0;
  saa = 0;
  sbb = 0;
  add(a: number, b: number) {
    this.n++;
    this.sa += a;
    this.sb += b;
    this.sab += a * b;
    this.saa += a * a;
    this.sbb += b * b;
  }
  value(): number {
    if (this.n < 8) return -1;
    const cov = this.sab - (this.sa * this.sb) / this.n;
    const va = this.saa - (this.sa * this.sa) / this.n;
    const vb = this.sbb - (this.sb * this.sb) / this.n;
    if (va <= 0 || vb <= 0) return -1;
    return cov / Math.sqrt(va * vb);
  }
}

function combine(skin: number, edge: number, opts: HeadAlignOptions) {
  return opts.skinWeight * skin + (1 - opts.skinWeight) * edge;
}

/**
 * Masked two-channel score of `ref` against `target` under `t`, and the
 * share of the reference head the target head covers. -1 when the heads
 * barely overlap.
 */
export function headScore(
  ref: HeadFeatures,
  target: HeadFeatures,
  t: Similarity,
  opts: HeadAlignOptions = DEFAULT_HEAD_ALIGN,
): { score: number; overlap: number } {
  const { a, b, ox, oy } = pixelMap(ref, target, t);
  const { width: w, height: h } = ref;
  const skin = new Corr();
  const edge = new Corr();
  let refArea = 0;
  let both = 0;
  for (let y = 0; y < h; y++) {
    let X = ox - b * y;
    let Y = oy + a * y;
    for (let x = 0; x < w; x++, X += a, Y += b) {
      const i = y * w + x;
      if (!ref.mask[i]) continue;
      refArea++;
      const m = sample(target.mask, target.width, target.height, X, Y);
      if (!(m > 0.5)) continue;
      both++;
      skin.add(
        ref.skin[i],
        sample(target.skin, target.width, target.height, X, Y),
      );
      if (
        ref.edgeMask[i] &&
        sample(target.edgeMask, target.width, target.height, X, Y) > 0.5
      )
        edge.add(
          ref.edge[i],
          sample(target.edge, target.width, target.height, X, Y),
        );
    }
  }
  const overlap = refArea ? both / refArea : 0;
  if (overlap < MIN_OVERLAP) return { score: -1, overlap };
  return { score: combine(skin.value(), edge.value(), opts), overlap };
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d <= -Math.PI) d += 2 * Math.PI;
  if (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

/**
 * Exhaustive turn × scale × shift search at the coarsest level, on head
 * pixels only. Returns the best few transforms that are not near-duplicates.
 * Yields before each turn.
 */
function* coarseSearch(
  ref: HeadFeatures,
  target: HeadFeatures,
  opts: HeadAlignOptions,
): Steps<Similarity[]> {
  const { width: w, height: h } = ref;
  const rcx = (w - 1) / 2;
  const rcy = (h - 1) / 2;
  const tw = target.width;
  const th = target.height;
  const tcx = (tw - 1) / 2;
  const tcy = (th - 1) / 2;
  const maxShift = Math.ceil(opts.maxTranslation * w);
  let refArea = 0;
  for (let i = 0; i < ref.mask.length; i++) refArea += ref.mask[i];
  // No head in the reference: nothing to match, rather than floor scores.
  if (refArea === 0) return [];
  const minPixels = MIN_OVERLAP * refArea;
  const wSkin = new Float32Array(w * h);
  const wEdge = new Float32Array(w * h);
  const wMask = new Uint8Array(w * h);
  const wEdgeMask = new Uint8Array(w * h);
  const found: { t: Similarity; score: number }[] = [];

  const rotations: number[] = [];
  for (let deg = -180; deg < 180 - 1e-9; deg += opts.rotationStepDeg)
    rotations.push((deg * Math.PI) / 180);
  const scales: number[] = [];
  for (let s = opts.minScale; s <= opts.maxScale * 1.0001; s *= opts.scaleStep)
    scales.push(s);

  for (const rotation of rotations) {
    yield;
    for (const scale of scales) {
      const a = Math.cos(rotation) * scale;
      const b = Math.sin(rotation) * scale;
      // Warp the target into the reference frame about both centres.
      for (let y = 0; y < h; y++) {
        const v = (y - rcy) / w;
        for (let x = 0; x < w; x++) {
          const u = (x - rcx) / w;
          const X = (a * u - b * v) * tw + tcx;
          const Y = (b * u + a * v) * tw + tcy;
          const i = y * w + x;
          const m = sample(target.mask, tw, th, X, Y);
          wMask[i] = m > 0.5 ? 1 : 0;
          if (!wMask[i]) {
            wEdgeMask[i] = 0;
            continue;
          }
          wSkin[i] = sample(target.skin, tw, th, X, Y);
          wEdge[i] = sample(target.edge, tw, th, X, Y);
          wEdgeMask[i] =
            sample(target.edgeMask, tw, th, X, Y) > 0.5 ? 1 : 0;
        }
      }
      // ref(p) against warped(p + d) for every integer shift d.
      for (let dy = -maxShift; dy <= maxShift; dy++) {
        const y0 = Math.max(0, -dy);
        const y1 = Math.min(h, h - dy);
        for (let dx = -maxShift; dx <= maxShift; dx++) {
          const x0 = Math.max(0, -dx);
          const x1 = Math.min(w, w - dx);
          const skin = new Corr();
          const edge = new Corr();
          for (let y = y0; y < y1; y++) {
            let i = y * w + x0;
            let j = (y + dy) * w + x0 + dx;
            for (let x = x0; x < x1; x++, i++, j++) {
              if (!ref.mask[i] || !wMask[j]) continue;
              skin.add(ref.skin[i], wSkin[j]);
              if (ref.edgeMask[i] && wEdgeMask[j]) edge.add(ref.edge[i], wEdge[j]);
            }
          }
          if (skin.n < minPixels) continue;
          const score = combine(skin.value(), edge.value(), opts);
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
  const picked: Similarity[] = [];
  for (const { t } of found) {
    const distinct = picked.every(
      (p) =>
        Math.abs(angleDiff(p.rotation, t.rotation)) >
          (opts.rotationStepDeg * 1.5 * Math.PI) / 180 ||
        Math.abs(Math.log(p.scale / t.scale)) > Math.log(opts.scaleStep) * 1.5 ||
        Math.hypot(p.tx - t.tx, p.ty - t.ty) > 3 / w,
    );
    if (distinct) picked.push(t);
    if (picked.length === opts.candidates) break;
  }
  return picked;
}

/** Pattern search from `init` at one level. */
function refine(
  ref: HeadFeatures,
  target: HeadFeatures,
  init: Similarity,
  steps: { rotationStep: number; logScaleStep: number },
  opts: HeadAlignOptions,
): { transform: Similarity; score: number } {
  let best = init;
  let bestScore = headScore(ref, target, init, opts).score;
  let translationStep = 1 / ref.width;
  let { rotationStep, logScaleStep } = steps;
  const minTranslationStep = 0.2 / ref.width;
  const minScale = opts.minScale / 1.2;
  const maxScale = opts.maxScale * 1.2;
  for (let iter = 0; iter < 300 && translationStep >= minTranslationStep; iter++) {
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
      const score = headScore(ref, target, move, opts).score;
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

/** Centroid of a mask in width-normalised, centre-origin units. */
function centroid(f: HeadFeatures): [number, number] {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < f.height; y++)
    for (let x = 0; x < f.width; x++)
      if (f.mask[y * f.width + x]) {
        n++;
        sx += x;
        sy += y;
      }
  if (!n) return [0, 0];
  return [
    (sx / n - (f.width - 1) / 2) / f.width,
    (sy / n - (f.height - 1) / 2) / f.width,
  ];
}

/** `t` turned by `dTheta`, keeping the head centroids on each other. */
function turned(
  t: Similarity,
  dTheta: number,
  ca: [number, number],
  cb: [number, number],
): Similarity {
  const rotation = t.rotation + dTheta;
  const c = Math.cos(rotation) * t.scale;
  const s = Math.sin(rotation) * t.scale;
  return {
    rotation,
    scale: t.scale,
    tx: cb[0] - (c * ca[0] - s * ca[1]),
    ty: cb[1] - (s * ca[0] + c * ca[1]),
  };
}

/**
 * Estimate the similarity mapping `ref` onto `target` from their head
 * features (finest level first). Returns the best transform, the best in
 * each quarter-turn basin, and whether the turn is ambiguous. Yields between
 * stages; see `alignHeads` and `alignHeadsAsync`.
 */
export function* alignHeadsSteps(
  ref: HeadFeatures[],
  target: HeadFeatures[],
  options: Partial<HeadAlignOptions> = {},
): Steps<HeadAlignResult> {
  const opts = { ...DEFAULT_HEAD_ALIGN, ...options };
  const coarsest = ref.length - 1;
  const picked = yield* coarseSearch(ref[coarsest], target[coarsest], opts);
  let candidates = picked.map((transform) => ({ transform, score: -Infinity }));
  if (!candidates.length)
    return {
      transform: { ...IDENTITY },
      score: 0,
      alternatives: [],
      ambiguous: false,
      overlap: 0,
    };
  let rotationStep = (opts.rotationStepDeg / 3) * (Math.PI / 180);
  let logScaleStep = Math.log(opts.scaleStep) / 2;
  for (let level = coarsest; level >= 0; level--) {
    const refined: { transform: Similarity; score: number }[] = [];
    for (const c of candidates) {
      yield;
      refined.push(
        refine(ref[level], target[level], c.transform, { rotationStep, logScaleStep }, opts),
      );
    }
    candidates = refined.sort((a, b) => b.score - a.score);
    candidates = candidates.slice(0, Math.max(1, candidates.length >> 2));
    rotationStep /= 2;
    logScaleStep /= 2;
  }
  const best = candidates[0];

  // The other turn basins, refined from the best at the two finest levels.
  const ca = centroid(ref[0]);
  const cb = centroid(target[0]);
  const basins = [best];
  for (const d of [Math.PI, Math.PI / 2, -Math.PI / 2]) {
    let current = turned(best.transform, d, ca, cb);
    let result = { transform: current, score: -1 };
    let rs = (opts.rotationStepDeg / 3) * (Math.PI / 180);
    let ls = Math.log(opts.scaleStep) / 2;
    for (let level = Math.min(1, coarsest); level >= 0; level--) {
      yield;
      result = refine(ref[level], target[level], current, { rotationStep: rs, logScaleStep: ls }, opts);
      current = result.transform;
      rs /= 2;
      ls /= 2;
    }
    basins.push(result);
  }
  basins.sort((a, b) => b.score - a.score);
  // Keep one per basin: drop any within 45° of a better one.
  const alternatives: { transform: Similarity; score: number }[] = [];
  for (const b of basins) {
    if (
      alternatives.every(
        (a) => Math.abs(angleDiff(a.transform.rotation, b.transform.rotation)) > Math.PI / 4,
      )
    )
      alternatives.push(b);
  }
  const top = alternatives[0];
  const runnerUp = alternatives[1];
  return {
    transform: top.transform,
    score: top.score,
    alternatives,
    ambiguous: Boolean(runnerUp && runnerUp.score > top.score - opts.ambiguityMargin),
    overlap: headScore(ref[0], target[0], top.transform, opts).overlap,
  };
}

/** `alignHeadsSteps` run straight through, for scripts and tests. */
export function alignHeads(
  ref: HeadFeatures[],
  target: HeadFeatures[],
  options: Partial<HeadAlignOptions> = {},
): HeadAlignResult {
  return runSteps(alignHeadsSteps(ref, target, options));
}

/**
 * `alignHeadsSteps` with a pause between stages (about forty of them), so
 * the app's UI keeps up while a pair is matched.
 */
export function alignHeadsAsync(
  ref: HeadFeatures[],
  target: HeadFeatures[],
  options: Partial<HeadAlignOptions> = {},
  pause?: () => Promise<void>,
): Promise<HeadAlignResult> {
  return runStepsAsync(alignHeadsSteps(ref, target, options), pause);
}
