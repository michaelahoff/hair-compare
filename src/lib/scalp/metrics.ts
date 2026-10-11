/**
 * What one photo says about the scalp, in numbers: how much of the head
 * shows skin, how big the thin patch is, and how dense the visible hair
 * lines are in the crown against the ring of hair around it.
 *
 * These are estimates from a phone photo, not measurements: the scale is a
 * typical head width, lines are counted where a hair stands out from skin,
 * and long or wet hair hides and clumps. They are meant for comparing one
 * person's photos taken the same way, and the fields say when they can't be.
 *
 * Pure functions: no React or Expo imports.
 */
import { createImage, type GrayImage } from "../alignment/image";
import {
  connectedComponents,
  createMask,
  erode,
  gaussianBlur,
  type Mask,
} from "./image-ops";
import { headMask } from "./head-mask";
import { resizeRgb, type RgbImage } from "./rgb";
import { strandSteps, type StrandRegion } from "./strands";
import { runSteps, runStepsAsync, type Steps } from "../steps";
import type { HairLength } from "../model";

/** Bump when the figures change meaning or method, so kept ones are redone. */
export const METRICS_VERSION = 2;
/** Width the head is found at. */
export const MASK_WIDTH = 256;
/**
 * A typical adult head is about this wide ear to ear. Every distance below
 * is scaled from it, so counts per cm² are relative, not absolute.
 */
export const HEAD_WIDTH_CM = 15;
/** Skin map level above which the scalp counts as showing. */
export const EXPOSED = 0.35;
/** Radius of the crown disc and bounds of the ring, in cm from the patch centre. */
export const CROWN_RADIUS_CM = 2.5;
export const RING_CM: [number, number] = [3.5, 5.5];

export type ScalpMetrics = {
  version: number;
  hairLength: HairLength | null;
  /** Photo width the lines were found at. */
  width: number;
  /** False when the head touches the frame, so its width (and the scale) is a guess. */
  scaleKnown: boolean;
  pxPerCm: number;
  headAreaCm2: number;
  /** Share of the head where skin shows through. */
  exposure: number;
  /** Largest exposed area inside the head, in cm². */
  patchCm2: number;
  /** Patch centre as fractions of the photo's width and height. */
  patchCentre: { x: number; y: number };
  crown: StrandRegion;
  ring: StrandRegion;
  whole: StrandRegion;
  /** Crown line density over ring line density; null when the ring can't be measured. */
  crownToRing: number | null;
  /** Stereological cross-check of the whole head's line density; null when nothing was sampled. */
  transect: number | null;
  typicalLengthMm: number | null;
  /**
   * Whether the line counts mean much: with long hair, strands overlap and
   * only the exposed patch can be read, so densities are marked unreliable.
   */
  linesReliable: boolean;
};

/** The pixel masks behind the metrics, for drawing; not stored. */
export type ScalpMaps = {
  mask: Uint8Array;
  lines: Uint8Array;
  region: Uint8Array;
  width: number;
  height: number;
};

/** Nearest-neighbour resize of a mask to another size. */
function scaleMask(mask: Mask, width: number, height: number): Mask {
  const out = createMask(width, height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(mask.height - 1, Math.floor((y * mask.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(mask.width - 1, Math.floor((x * mask.width) / width));
      out.data[y * width + x] = mask.data[sy * mask.width + sx];
    }
  }
  return out;
}

function bounds(mask: Mask) {
  let x0 = mask.width;
  let y0 = mask.height;
  let x1 = -1;
  let y1 = -1;
  let area = 0;
  for (let y = 0; y < mask.height; y++)
    for (let x = 0; x < mask.width; x++)
      if (mask.data[y * mask.width + x]) {
        area++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return { x0, y0, x1, y1, area };
}

/**
 * Whether a photo's line counts mean much: with long hair, strands overlap
 * and only the exposed patch can be read.
 */
export function linesReliable(hairLength: HairLength | null): boolean {
  return hairLength === "buzzed" || hairLength === "short";
}

/**
 * The scalp metrics of a photo given as RGB pixels (any width; around
 * 900 px wide reads single hairs on a buzzed head without taking seconds).
 * Throws when no head is found. Yields between the heavy stages; see
 * `computeScalpMetrics` and `computeScalpMetricsAsync`.
 */
export function* scalpMetricsSteps(
  rgb: RgbImage,
  hairLength: HairLength | null,
): Steps<{ metrics: ScalpMetrics; maps: ScalpMaps }> {
  const small = resizeRgb(rgb, MASK_WIDTH);
  yield;
  const { mask, skin } = headMask(small);
  const box = bounds(mask);
  if (box.area === 0)
    throw new Error("No head was found in this photo.");
  yield;
  const touches =
    Number(box.x0 <= 1) +
    Number(box.x1 >= mask.width - 2) +
    Number(box.y0 <= 1) +
    Number(box.y1 >= mask.height - 2);
  const equivalentDiameter = 2 * Math.sqrt(box.area / Math.PI);
  const headPx =
    touches === 0 ? box.x1 - box.x0 : Math.max(equivalentDiameter, box.x1 - box.x0);
  const pxPerCmSmall = headPx / HEAD_WIDTH_CM;

  // Exposure: skin showing, smoothed over about 1.5 mm, inside the head.
  const blurred = gaussianBlur(skin, Math.max(1, pxPerCmSmall * 0.15));
  const exposed = createMask(mask.width, mask.height);
  let exposedCount = 0;
  for (let i = 0; i < exposed.data.length; i++)
    if (mask.data[i] && blurred.data[i] > EXPOSED) {
      exposed.data[i] = 1;
      exposedCount++;
    }
  const exposure = exposedCount / box.area;

  // The patch: the largest exposed area well inside the head.
  const inner = erode(mask, Math.max(1, Math.round(pxPerCmSmall * 0.5)));
  const candidate = createMask(mask.width, mask.height);
  for (let i = 0; i < candidate.data.length; i++)
    candidate.data[i] = exposed.data[i] & inner.data[i];
  const parts = connectedComponents(candidate, 8);
  let patchCm2 = 0;
  let centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  if (parts.count > 0) {
    const biggest = parts.stats.reduce((best, s) => (s.area > best.area ? s : best));
    patchCm2 = biggest.area / pxPerCmSmall ** 2;
    centre = { x: biggest.cx, y: biggest.cy };
  }

  // Lines at the photo's own resolution.
  const scale = rgb.width / mask.width;
  const full = scaleMask(mask, rgb.width, rgb.height);
  const pxPerCm = pxPerCmSmall * scale;
  const strands = yield* strandSteps(rgb, full, pxPerCm, {
    x: centre.x * scale,
    y: centre.y * scale,
  });
  return {
    metrics: {
      version: METRICS_VERSION,
      hairLength,
      width: rgb.width,
      scaleKnown: touches === 0,
      pxPerCm,
      headAreaCm2: box.area / pxPerCmSmall ** 2,
      exposure,
      patchCm2,
      patchCentre: { x: centre.x / mask.width, y: centre.y / mask.height },
      crown: strands.crown,
      ring: strands.ring,
      whole: strands.whole,
      crownToRing: strands.crownToRing,
      transect: strands.transect,
      typicalLengthMm: strands.typicalLengthMm,
      linesReliable: linesReliable(hairLength),
    },
    maps: {
      mask: full.data,
      lines: strands.lines,
      region: strands.region,
      width: rgb.width,
      height: rgb.height,
    },
  };
}

/** `scalpMetricsSteps` run straight through, for scripts and tests. */
export function computeScalpMetrics(
  rgb: RgbImage,
  hairLength: HairLength | null,
): { metrics: ScalpMetrics; maps: ScalpMaps } {
  return runSteps(scalpMetricsSteps(rgb, hairLength));
}

/**
 * `scalpMetricsSteps` with a pause between stages (about eight of them), so
 * a phone's UI keeps up while a photo is read.
 */
export function computeScalpMetricsAsync(
  rgb: RgbImage,
  hairLength: HairLength | null,
  pause?: () => Promise<void>,
): Promise<{ metrics: ScalpMetrics; maps: ScalpMaps }> {
  return runStepsAsync(scalpMetricsSteps(rgb, hairLength), pause);
}

/** A grey image of the skin map at mask size, for drawing or tests. */
export function skinImage(rgb: RgbImage): GrayImage {
  const { skin } = headMask(resizeRgb(rgb, MASK_WIDTH));
  const out = createImage(skin.width, skin.height);
  out.data.set(skin.data);
  return out;
}

/**
 * Whether two photos' metrics can be set against each other: same hair
 * length, both with known scale, and lines reliable in both (or neither).
 */
export function comparable(
  a: ScalpMetrics,
  b: ScalpMetrics,
): { ok: boolean; reason: string | null } {
  if (a.hairLength && b.hairLength && a.hairLength !== b.hairLength)
    return { ok: false, reason: "different hair length" };
  if (!a.scaleKnown || !b.scaleKnown)
    return { ok: false, reason: "the head is cut off in one photo, so sizes are guessed" };
  if (a.linesReliable !== b.linesReliable)
    return { ok: false, reason: "hair lines can only be counted on short hair" };
  return { ok: true, reason: null };
}

/** One sentence on what a photo's numbers show. */
export function metricsSentence(m: ScalpMetrics): string {
  const patch = `${m.patchCm2.toFixed(0)} cm² of scalp shows in the crown`;
  if (!m.linesReliable)
    return `${patch} (${Math.round(m.exposure * 100)}% of the head). Hair lines aren't counted on longer hair.`;
  if (m.crownToRing === null || m.crown.density === null || m.ring.density === null)
    return `${patch}. The ring around it couldn't be measured, so there is no crown-to-ring figure.`;
  return `${patch}. The crown shows ${m.crownToRing.toFixed(2)}× the hair-line density of the ring around it (${m.crown.density.toFixed(1)} vs ${m.ring.density.toFixed(1)} cm of hair per cm²).`;
}
