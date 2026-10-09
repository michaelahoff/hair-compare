/**
 * Texture change between two photos of one view, compared on the view's
 * guide. Hair on skin has strong fine edges and bare scalp has few, so more
 * edge energy in the later photo reads as "more texture". This is a pointer
 * to look closer, not a measurement of hair.
 *
 * Pure functions on guide-space greyscale images: no React or Expo imports,
 * so it runs under `bun test`.
 */
import {
  blur,
  createImage,
  downsample,
  gradientMagnitude,
  sampleBilinear,
  type GrayImage,
} from "./alignment/image";
import type { HairLength } from "./model";

/** Guide-space resolution, in pixels a side. */
export const GUIDE_SIZE = 320;
/** Block side in guide pixels; the map is GUIDE_SIZE / BLOCK blocks a side. */
export const BLOCK = 16;
/** Relative changes within ± this are drawn transparent. */
export const CHANGE_THRESHOLD = 0.12;
/** Relative change at which a block reaches full overlay alpha. */
export const CHANGE_FULL = 0.6;
export const ALPHA_MIN = 0.25;
export const ALPHA_MAX = 0.75;
/** Overlay colours, as RGB. */
export const GAINED_RGB = [92, 201, 128] as const;
export const LOST_RGB = [242, 181, 68] as const;
/** Below this share of blocks covered by both photos, confidence is low. */
export const MIN_COVERAGE = 0.6;
/**
 * Blur passes at quarter resolution: about 4 px sigma at GUIDE_SIZE. Wider
 * windows let a dense patch's spread leak two blocks out and fake a change.
 */
export const NORMALISE_PASSES = 2;
/**
 * Local spread is floored at this multiple of the photo's median spread. Skin
 * micro-texture then counts for little, and only structure well above the
 * photo's usual level reads as texture. Gain-invariant for any value.
 */
export const STD_FLOOR_MULTIPLE = 3;
/** Share of a block's pixels counted in both photos for it to be valid. */
export const BLOCK_MIN_COVERAGE = 0.75;
/**
 * Blocks below this texture in both photos are flat skin or sensor noise and
 * count as no change. Set from the ghost fixture with fresh noise on one side:
 * at 0.05 nearly-flat blocks swing by up to 0.9, at 0.2 none exceed 0.04.
 */
export const NOISE_FLOOR = 0.2;

const EPS = 1e-6;
/** Below this share of quarter-resolution pixels valid in both, no match. */
const MATCH_MIN_SHARE = 0.1;
/** The spread map is smooth, so every few pixels is enough for its median. */
const MEDIAN_STRIDE = 7;

/** 1 where the photo covers the guide pixel, 0 where it doesn't. */
export type GuideMask = Uint8Array;

export type ChangeMap = {
  /** Blocks a side. */
  size: number;
  /** Smoothed relative texture change per block, row-major, in [-1, 1]; NaN where invalid. */
  values: Float32Array;
  /** Overlay colour per block, row-major RGBA 0-255; alpha 0 where unchanged or invalid. */
  rgba: Uint8ClampedArray;
  /** Share of valid blocks above +CHANGE_THRESHOLD. */
  gained: number;
  /** Share of valid blocks below -CHANGE_THRESHOLD. */
  lost: number;
  /** Share of all blocks covered by both photos. */
  coverage: number;
};

/**
 * Compare `before` and `after`, both GUIDE_SIZE square renders of one view's
 * guide. Pixels outside a mask are ignored, whatever their value.
 */
export function computeChangeMap(
  before: GrayImage,
  after: GrayImage,
  masks: { before: GuideMask; after: GuideMask },
): ChangeMap {
  const size = Math.floor(before.width / BLOCK);
  const count = size * size;
  const b = blockTexture(before, masks.before, size);
  const a = blockTexture(after, masks.after, size);

  const valid = new Uint8Array(count);
  const raw = new Float32Array(count);
  let validCount = 0;
  for (let i = 0; i < count; i++) {
    if (
      a.coverage[i] < BLOCK_MIN_COVERAGE ||
      b.coverage[i] < BLOCK_MIN_COVERAGE
    )
      continue;
    valid[i] = 1;
    validCount++;
    const ta = a.texture[i];
    const tb = b.texture[i];
    raw[i] =
      ta < NOISE_FLOOR && tb < NOISE_FLOOR ? 0 : (ta - tb) / (ta + tb + EPS);
  }

  // Invalid neighbours are left out of the average rather than counted as
  // zero, so the edge of a photo doesn't fade the change map toward nothing.
  const values = new Float32Array(count).fill(Number.NaN);
  const rgba = new Uint8ClampedArray(count * 4);
  let gained = 0;
  let lost = 0;
  for (let by = 0; by < size; by++) {
    for (let bx = 0; bx < size; bx++) {
      const i = by * size + bx;
      if (!valid[i]) continue;
      let sum = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const y = by + dy;
          const x = bx + dx;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const j = y * size + x;
          if (!valid[j]) continue;
          const k = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
          sum += k * raw[j];
          weight += k;
        }
      }
      const d = sum / weight;
      values[i] = d;
      if (d > CHANGE_THRESHOLD) gained++;
      else if (d < -CHANGE_THRESHOLD) lost++;

      const magnitude = Math.abs(d);
      if (magnitude <= CHANGE_THRESHOLD) continue;
      const t = Math.min(
        1,
        (magnitude - CHANGE_THRESHOLD) / (CHANGE_FULL - CHANGE_THRESHOLD),
      );
      const alpha = ALPHA_MIN + t * (ALPHA_MAX - ALPHA_MIN);
      const rgb = d > 0 ? GAINED_RGB : LOST_RGB;
      rgba.set([rgb[0], rgb[1], rgb[2], Math.round(alpha * 255)], i * 4);
    }
  }
  return {
    size,
    values,
    rgba,
    gained: validCount ? gained / validCount : 0,
    lost: validCount ? lost / validCount : 0,
    coverage: count ? validCount / count : 0,
  };
}

/**
 * How well the two renders line up: normalised cross-correlation of their
 * edge maps over pixels both cover, -1..1. Comparable with `MIN_MATCH`.
 */
export function matchScore(
  before: GrayImage,
  after: GrayImage,
  masks: { before: GuideMask; after: GuideMask },
): number {
  const a = edgeMap(before, masks.before);
  const b = edgeMap(after, masks.after);
  let n = 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < a.edges.length; i++) {
    if (!a.valid[i] || !b.valid[i]) continue;
    n++;
    sumA += a.edges[i];
    sumB += b.edges[i];
  }
  if (n === 0 || n < MATCH_MIN_SHARE * a.edges.length) return -1;
  const meanA = sumA / n;
  const meanB = sumB / n;
  let cross = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < a.edges.length; i++) {
    if (!a.valid[i] || !b.valid[i]) continue;
    const da = a.edges[i] - meanA;
    const db = b.edges[i] - meanB;
    cross += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (!(varA > 0) || !(varB > 0)) return -1;
  return cross / Math.sqrt(varA * varB);
}

type Texture = { texture: Float32Array; coverage: Float32Array };

/** Regional average: a blurred quarter-size copy, brought back to full size. */
function smooth(img: GrayImage): GrayImage {
  const low = blur(downsample(downsample(img)), NORMALISE_PASSES);
  return upsample(low, img.width, img.height);
}

function upsample(img: GrayImage, width: number, height: number): GrayImage {
  const out = createImage(width, height);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), img.height - 1);
    for (let x = 0; x < width; x++) {
      const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), img.width - 1);
      out.data[y * width + x] = sampleBilinear(img, fx, fy);
    }
  }
  return out;
}

function median(values: Float32Array, mask: GuideMask): number {
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += MEDIAN_STRIDE)
    if (mask[i]) sample.push(values[i]);
  if (!sample.length) return 0;
  sample.sort((p, q) => p - q);
  return sample[sample.length >> 1];
}

/**
 * Residual from the regional mean, divided by the regional spread, so bright
 * and dim areas, and busy and bare ones, are compared on the same scale.
 * Only valid pixels enter any regional average.
 */
function normalise(img: GrayImage, mask: GuideMask): GrayImage {
  const { width: w, height: h, data } = img;
  const coverage = createImage(w, h);
  coverage.data.set(mask);
  const kept = createImage(w, h);
  for (let i = 0; i < data.length; i++) if (mask[i]) kept.data[i] = data[i];
  const weight = smooth(coverage);
  const sum = smooth(kept);

  const residual = createImage(w, h);
  const residualSq = createImage(w, h);
  for (let i = 0; i < data.length; i++) {
    if (!mask[i]) continue;
    const r = data[i] - sum.data[i] / Math.max(weight.data[i], EPS);
    residual.data[i] = r;
    residualSq.data[i] = r * r;
  }
  const variance = smooth(residualSq);
  const spread = createImage(w, h);
  for (let i = 0; i < data.length; i++)
    spread.data[i] = Math.sqrt(
      variance.data[i] / Math.max(weight.data[i], EPS),
    );

  const floor = STD_FLOOR_MULTIPLE * median(spread.data, mask);
  const out = createImage(w, h);
  for (let i = 0; i < data.length; i++) {
    if (mask[i])
      out.data[i] = residual.data[i] / Math.max(spread.data[i], floor, EPS);
  }
  return out;
}

/** Mean gradient energy of the normalised image in each block. */
function blockTexture(img: GrayImage, mask: GuideMask, size: number): Texture {
  const { width: w, height: h } = img;
  const edge = gradientMagnitude(normalise(img, mask)).data;
  const sum = new Float64Array(size * size);
  const count = new Uint32Array(size * size);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      // A gradient next to the photo's edge is the edge, not the hair.
      if (
        !mask[i] ||
        !mask[i - 1] ||
        !mask[i + 1] ||
        !mask[i - w] ||
        !mask[i + w]
      )
        continue;
      const bx = Math.floor(x / BLOCK);
      const by = Math.floor(y / BLOCK);
      if (bx >= size || by >= size) continue;
      sum[by * size + bx] += edge[i];
      count[by * size + bx]++;
    }
  }
  const texture = new Float32Array(size * size);
  const coverage = new Float32Array(size * size);
  for (let b = 0; b < size * size; b++) {
    texture[b] = count[b] ? sum[b] / count[b] : 0;
    coverage[b] = count[b] / (BLOCK * BLOCK);
  }
  return { texture, coverage };
}

/** Edge energy at quarter resolution, where every pixel read is valid. */
function edgeMap(
  img: GrayImage,
  mask: GuideMask,
): { edges: Float32Array; valid: Uint8Array } {
  const half = downsample(img);
  const halfMask = halve(mask, img.width, img.height);
  const quarter = downsample(half);
  const quarterMask = halve(halfMask, half.width, half.height);

  // Replace invalid pixels with the valid mean so the blur and gradient see
  // no step at the photo's edge, and nothing outside the mask.
  let sum = 0;
  let n = 0;
  for (let i = 0; i < quarterMask.length; i++)
    if (quarterMask[i]) {
      sum += quarter.data[i];
      n++;
    }
  const fill = n ? sum / n : 0;
  for (let i = 0; i < quarterMask.length; i++)
    if (!quarterMask[i]) quarter.data[i] = fill;

  return {
    edges: gradientMagnitude(blur(quarter, 1)).data,
    valid: erode(quarterMask, quarter.width, quarter.height),
  };
}

/** A half-size pixel is valid only if all four pixels under it are. */
function halve(mask: GuideMask, width: number, height: number): GuideMask {
  const w = width >> 1;
  const out = new Uint8Array(w * (height >> 1));
  for (let y = 0; y < height >> 1; y++) {
    for (let x = 0; x < w; x++) {
      const i = 2 * y * width + 2 * x;
      out[y * w + x] =
        mask[i] & mask[i + 1] & mask[i + width] & mask[i + width + 1];
    }
  }
  return out;
}

/** A pixel stays valid only if its 3 × 3 neighbourhood is valid. */
function erode(mask: GuideMask, width: number, height: number): GuideMask {
  const out = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let ok = 1;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          ok &= mask[(y + dy) * width + x + dx];
      out[y * width + x] = ok;
    }
  }
  return out;
}

type Conditions = { hair_length: HairLength | null; hair_wet: boolean };

/**
 * Low when the photos barely overlap, don't line up closely, or differ in
 * hair length or wetness. A low-confidence map still draws, with the reason.
 */
export function changeConfidence(input: {
  coverage: number;
  match: number;
  minMatch: number;
  before: Conditions;
  after: Conditions;
}): { confidence: "low" | "ok"; reason: string | null } {
  const { before, after } = input;
  const differences = [
    before.hair_length &&
      after.hair_length &&
      before.hair_length !== after.hair_length &&
      "hair length",
    before.hair_wet !== after.hair_wet && "wetness",
  ].filter(Boolean);
  if (differences.length)
    return {
      confidence: "low",
      reason: `Low confidence: different ${differences.join(" and ")}`,
    };
  if (input.coverage < MIN_COVERAGE)
    return {
      confidence: "low",
      reason: "Low confidence: the photos only partly overlap",
    };
  if (!(input.match >= input.minMatch))
    return {
      confidence: "low",
      reason: "Low confidence: the photos don't line up closely",
    };
  return { confidence: "ok", reason: null };
}
