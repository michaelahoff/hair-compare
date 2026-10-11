/**
 * Hair-strand density on a scalp photo, from its ridge map. Takes the photo,
 * the head mask at the same size, the pixels-per-cm scale and the patch
 * centre. Finds dark hair lines, then measures line length per area in a
 * crown disc, a ring around it and the whole head, with a stereological
 * cross-check and the typical unbroken hair length. Mirrors `analyse` in
 * scripts/real-photo-eval/proto/strands3.py. Pure TypeScript: no React, Expo
 * or Node imports.
 */
import { createImage } from "../alignment/image";
import { erode, type Mask } from "./image-ops";
import {
  lineDensity,
  multiRidge,
  removeShort,
  splitAtJunctions,
  thinLines,
  transectDensity,
} from "./ridge";
import { lumaOf, type RgbImage } from "./rgb";

export type StrandRegion = { lengthCm: number; areaCm2: number; density: number };
export type StrandAnalysis = {
  /** Thin ridge-centre mask over the input image, 1 = hair line. */
  lines: Uint8Array;
  /** Where strands were counted (eroded head mask), 1 = inside. */
  region: Uint8Array;
  /** 2.5 cm disc about the patch centre. */
  crown: StrandRegion;
  /** 3.5 to 5.5 cm ring about the patch centre. */
  ring: StrandRegion;
  whole: StrandRegion;
  /** crown.density / ring.density, null when the ring is too small or empty. */
  crownToRing: number | null;
  /** Stereological cross-check for the whole region. */
  transect: number;
  /** 80th percentile of unbroken piece length in mm, null when fewer than 20 pieces. */
  typicalLengthMm: number | null;
  /** Threshold used, so a UI can say how it was set. */
  threshold: number;
};

/** Crown disc radius about the patch centre, in cm. */
const CROWN_RADIUS_CM = 2.5;
/** Ring about the patch centre, in cm. Its inner and outer radii. */
const RING_INNER_CM = 3.5;
const RING_OUTER_CM = 5.5;
/** A ring with less area than this gives no usable crown-to-ring ratio. */
const MIN_RING_AREA_CM2 = 2;
/** Lowest threshold on the normalised response, however clean the photo. */
const MIN_THRESHOLD = 0.1;
/** Unbroken pieces shorter than this, in cm, are left out of the typical length. */
const MIN_PIECE_CM = 0.1;
/** Fewest pieces needed before a typical length is reported. */
const MIN_PIECES_FOR_TYPICAL = 20;

/**
 * Percentile by linear interpolation between neighbouring samples, as numpy
 * gives by default. `sorted` must be ascending. `map` is applied to the two
 * samples used; that is exact when `map` never decreases, since the mapped
 * array then stays sorted. Returns NaN for an empty array.
 */
function percentileOf(
  sorted: ArrayLike<number>,
  p: number,
  map: (v: number) => number = (v) => v,
): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const a = map(sorted[lo]);
  const b = map(sorted[hi]);
  return a + (b - a) * (pos - lo);
}

/** The values of `response` inside `region`, sorted ascending. */
function sortedInside(response: Float32Array, region: Uint8Array): Float32Array {
  let count = 0;
  for (let i = 0; i < region.length; i++) if (region[i] !== 0) count++;
  const out = new Float32Array(count);
  let k = 0;
  for (let i = 0; i < region.length; i++) {
    if (region[i] !== 0) out[k++] = response[i];
  }
  return out.sort();
}

/**
 * Crown disc and ring as 0/1 masks inside `region`, split by distance in cm
 * from the patch centre. The two never overlap.
 */
function zoneMasks(
  w: number,
  h: number,
  region: Uint8Array,
  centre: { x: number; y: number },
  pxPerCm: number,
): { crown: Uint8Array; ring: Uint8Array } {
  const crown = new Uint8Array(w * h);
  const ring = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (region[i] === 0) continue;
      const d = Math.hypot(x - centre.x, y - centre.y) / pxPerCm;
      if (d < CROWN_RADIUS_CM) crown[i] = 1;
      else if (d > RING_INNER_CM && d < RING_OUTER_CM) ring[i] = 1;
    }
  }
  return { crown, ring };
}

/**
 * Crown density over ring density. Null when the ring is too small to measure,
 * when it has no hair at all (0 / 0 is undefined, so it is not reported as 0),
 * or when the crown is too small to measure.
 */
function crownOverRing(crown: StrandRegion, ring: StrandRegion): number | null {
  if (ring.areaCm2 < MIN_RING_AREA_CM2) return null;
  if (!(ring.density > 0)) return null;
  if (Number.isNaN(crown.density)) return null;
  return crown.density / ring.density;
}

/**
 * 80th percentile of the unbroken piece lengths, in mm. Pieces shorter than
 * 0.1 cm are ignored. Null when fewer than 20 pieces remain, since a
 * percentile of a handful of pieces says little.
 */
function typicalLengthMm(
  lines: Uint8Array,
  w: number,
  h: number,
  pxPerCm: number,
): number | null {
  const { lengths } = splitAtJunctions(lines, w, h);
  const minPx = pxPerCm * MIN_PIECE_CM;
  const pieces = Float64Array.from(lengths.filter((n) => n >= minPx)).sort();
  if (pieces.length < MIN_PIECES_FOR_TYPICAL) return null;
  return (percentileOf(pieces, 80) / pxPerCm) * 10;
}

/**
 * Finds the hair lines in a scalp photo and measures their density. The photo
 * is read as luma (0..1), so dark hair on pale skin gives the ridges.
 * `patchCentre` is in pixel index coordinates, the same as the mask.
 *
 * Each step is scaled to the photo: the hair width is set from `pxPerCm`, and
 * the ridge response is divided by its 99th percentile inside the region so
 * one threshold works across photos. Lines are kept only where the response
 * is above the threshold, which is the 75th percentile inside the region (and
 * at least 0.1). Short pieces are removed afterwards.
 *
 * A patch with no hair gives zero densities and a null crown-to-ring ratio.
 * Throws when `pxPerCm` is not positive or the mask and photo sizes differ.
 */
export function analyseStrands(
  rgb: RgbImage,
  mask: Mask,
  pxPerCm: number,
  patchCentre: { x: number; y: number },
): StrandAnalysis {
  if (!(pxPerCm > 0)) throw new Error("analyseStrands: pxPerCm must be positive");
  if (mask.width !== rgb.width || mask.height !== rgb.height) {
    throw new Error("analyseStrands: mask and photo sizes differ");
  }
  const { width: w, height: h } = rgb;

  const luma = lumaOf(rgb);
  for (let i = 0; i < luma.data.length; i++) luma.data[i] /= 255;
  const hairPx = Math.max(0.8, pxPerCm * 0.008);
  const ridge = multiRidge(
    luma,
    [0.8, 1.2, 1.8].map((k) => k * hairPx),
    true,
  );

  const region = erode(mask, Math.round(pxPerCm * 0.2)).data;
  const response = ridge.response.data;
  const inside = sortedInside(response, region);
  const scale = inside.length > 0 ? percentileOf(inside, 99) + 1e-6 : 1;
  const unit = (v: number) => Math.min(1, Math.max(0, v / scale));
  const normalised = createImage(w, h);
  for (let i = 0; i < response.length; i++) {
    normalised.data[i] = unit(response[i]);
  }
  const threshold = Math.max(
    inside.length > 0 ? percentileOf(inside, 75, unit) : 0,
    MIN_THRESHOLD,
  );

  const lines = removeShort(
    thinLines(normalised, ridge.theta, threshold, region),
    w,
    h,
    Math.round(pxPerCm * 0.08),
  );

  const zones = zoneMasks(w, h, region, patchCentre, pxPerCm);
  const crown = lineDensity(lines, zones.crown, w, h, pxPerCm);
  const ring = lineDensity(lines, zones.ring, w, h, pxPerCm);
  const whole = lineDensity(lines, region, w, h, pxPerCm);

  return {
    lines,
    region,
    crown,
    ring,
    whole,
    crownToRing: crownOverRing(crown, ring),
    transect: transectDensity(
      lines,
      region,
      w,
      h,
      pxPerCm,
      Math.max(2, Math.round(pxPerCm * 0.05)),
    ),
    typicalLengthMm: typicalLengthMm(lines, w, h, pxPerCm),
    threshold,
  };
}

/**
 * One plain sentence for a UI, saying how the crown compares with the ring.
 * Numbers are rounded to one decimal place. When there is no ratio, the
 * sentence says which measurement failed, since a zero-hair ring is not the
 * same as a ring that could not be measured.
 */
export function strandSummary(a: StrandAnalysis): string {
  if (a.crownToRing !== null) {
    return `Crown shows ${a.crownToRing.toFixed(1)}× the hair-line density of the surrounding ring (${a.crown.density.toFixed(1)} vs ${a.ring.density.toFixed(1)} cm of hair per cm²).`;
  }
  if (a.ring.areaCm2 < MIN_RING_AREA_CM2 || Number.isNaN(a.ring.density)) {
    return "The surrounding ring could not be measured, so the crown cannot be compared with it.";
  }
  if (a.ring.density === 0) {
    return "No hair lines were found in the surrounding ring, so the crown cannot be compared with it.";
  }
  return "The crown patch is too small to measure, so it cannot be compared with the ring.";
}
