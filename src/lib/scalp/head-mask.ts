/**
 * Finds the head in a top-down scalp photo. headMask marks the hair and scalp
 * region: finely textured pixels that are dark (hair), reddish (scalp showing
 * through stubble or thin hair) or mid-grey (grey hair), plus the skin enclosed
 * by or next to them. patchCentre locates the thin or bald patch inside that
 * mask. A port of the skin_map, texture_map, head_mask and core_of functions
 * in scripts/real-photo-eval/proto/headalign.py. Pure TypeScript: no React,
 * Expo or Node imports.
 */
import { createImage, type GrayImage } from "../alignment/image";
import { chromaOf, lumaOf, saturationOf, type RgbImage } from "./rgb";
import {
  connectedComponents,
  createMask,
  dilate,
  distanceTransform,
  erode,
  fillHoles,
  gaussianBlur,
  largestComponent,
  localStd,
  maskFrom,
  type Mask,
} from "./image-ops";

/** Clamp to 0..1, as np.clip(x, 0, 1) does in the prototype. */
function clip01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A new image whose pixel i (row-major) is f(i). */
function mapImage(
  width: number,
  height: number,
  f: (i: number) => number,
): GrayImage {
  const out = createImage(width, height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = f(i);
  return out;
}

/**
 * How skin-like each pixel is, 0..1. Skin is reddish (Cr above 138), not too
 * blue (Cb below 132) and not too dark (Y above 60). Each condition ramps
 * linearly over a band, and the three are multiplied, so all must hold.
 */
export function skinMap(rgb: RgbImage): GrayImage {
  const luma = lumaOf(rgb);
  const { cr, cb } = chromaOf(rgb);
  return mapImage(rgb.width, rgb.height, (i) =>
    clip01((cr.data[i] - 138) / 12) *
    clip01((132 - cb.data[i]) / 12) *
    clip01((luma.data[i] - 60) / 40),
  );
}

/**
 * Fine texture of a luma image (0..255): the local standard deviation of the
 * detail a `fine`-sigma blur removes, averaged over a `window`-sigma area.
 * Hair strands score high; smooth skin and flat walls score near zero.
 */
export function textureMap(
  luma: GrayImage,
  fine: number,
  window: number,
): GrayImage {
  return localStd(luma, fine, window);
}

/**
 * Radius of the elliptical structuring element OpenCV builds for a kernel
 * `size` pixels across: the size is forced odd and the radius is (size - 1) / 2.
 */
function kernelRadius(size: number): number {
  return (Math.trunc(size) | 1) >> 1;
}

/**
 * Erosion with pixels beyond the frame counted as inside, which is what
 * OpenCV's morphologyEx does by default. image-ops' erode counts them as
 * outside, which would eat a mask back from every frame edge it touches. So
 * the mask is padded with inside pixels, eroded, and cropped again.
 */
function erodeAtFrame(mask: Mask, radius: number): Mask {
  const { width: w, height: h } = mask;
  const pad = Math.max(0, Math.round(radius));
  const pw = w + 2 * pad;
  const padded = createMask(pw, h + 2 * pad);
  padded.data.fill(1);
  for (let y = 0; y < h; y++) {
    padded.data.set(
      mask.data.subarray(y * w, (y + 1) * w),
      (y + pad) * pw + pad,
    );
  }
  const eroded = erode(padded, radius);
  const out = createMask(w, h);
  for (let y = 0; y < h; y++) {
    const from = (y + pad) * pw + pad;
    out.data.set(eroded.data.subarray(from, from + w), y * w);
  }
  return out;
}

/** OpenCV's MORPH_CLOSE with the frame-edge rule of erodeAtFrame. */
function closeAtFrame(mask: Mask, radius: number): Mask {
  return erodeAtFrame(dilate(mask, radius), radius);
}

/** OpenCV's MORPH_OPEN with the frame-edge rule of erodeAtFrame. */
function openAtFrame(mask: Mask, radius: number): Mask {
  return dilate(erodeAtFrame(mask, radius), radius);
}

/**
 * The fat part of a blob: pixels within reach of its thickest core, so thin
 * attachments (arms, collars, strips of floor) fall away. `s` is the width
 * scale, width / 256, which keeps the thresholds the same at any width.
 */
/** How far past its inscribed radius a head blob may reach. */
const DISC_FACTOR = 1.25;

function coreOf(blob: Mask, s: number): Mask {
  const dt = distanceTransform(blob);
  let r = 0;
  for (const v of dt.data) if (v > r) r = v;
  if (r < 4 * s) return blob;
  const core = connectedComponents(maskFrom(dt, 0.45 * r), 8);
  // Keep the core component that reaches furthest from the outside.
  const peak = new Float64Array(core.count);
  for (let i = 0; i < dt.data.length; i++) {
    const label = core.labels[i];
    if (label > 0 && dt.data[i] > peak[label - 1]) peak[label - 1] = dt.data[i];
  }
  let best = 0;
  for (let k = 1; k < core.count; k++) if (peak[k] > peak[best]) best = k;
  const thick = createMask(blob.width, blob.height);
  for (let i = 0; i < thick.data.length; i++) {
    thick.data[i] = core.labels[i] === best + 1 ? 1 : 0;
  }
  const rad = Math.trunc(0.45 * r + 3 * s) | 1;
  const grown = dilate(thick, rad);
  // A head seen from above is round: nothing further from the thickest
  // part than about its inscribed radius belongs to it, which cuts off the
  // sink, cabinet or collar a blob sometimes merges with.
  let n = 0;
  let cx = 0;
  let cy = 0;
  for (let y = 0; y < thick.height; y++)
    for (let x = 0; x < thick.width; x++)
      if (thick.data[y * thick.width + x]) {
        n++;
        cx += x;
        cy += y;
      }
  cx /= Math.max(1, n);
  cy /= Math.max(1, n);
  const reach = DISC_FACTOR * r + 3 * s;
  for (let y = 0; y < grown.height; y++)
    for (let x = 0; x < grown.width; x++) {
      const i = y * grown.width + x;
      grown.data[i] &= blob.data[i];
      if (grown.data[i] && Math.hypot(x - cx, y - cy) > reach) grown.data[i] = 0;
    }
  return fillHoles(grown);
}

/**
 * The head in a photo. `mask` is 1 on the head (hair and scalp, holes filled,
 * thin attachments trimmed). `skin` and `hairness` are the 0..1 maps the mask
 * is built from, returned for drawing and for tuning.
 */
export function headMask(rgb: RgbImage): {
  mask: Mask;
  skin: GrayImage;
  hairness: GrayImage;
} {
  const { width: w, height: h } = rgb;
  const s = w / 256;
  const luma = lumaOf(rgb);
  const { cr, cb } = chromaOf(rgb);
  const sat = saturationOf(rgb);
  const skin = skinMap(rgb);
  // Texture in units that do not depend on the width.
  const tex = textureMap(luma, 1.2 * s, 3 * s);
  for (let i = 0; i < tex.data.length; i++) tex.data[i] /= s;
  // Fine texture well above what tiles, fabric and walls show (they sit
  // around 3-6 at this scale; hair and stubble above 8).
  const hairness = mapImage(w, h, (i) => {
    const y = luma.data[i];
    const t = tex.data[i];
    const strong = clip01((t - 6) / 4);
    const very = clip01((t - 10) / 4);
    const dark = clip01((120 - y) / 40);
    const reddish =
      clip01((cr.data[i] - 136) / 8) * clip01((134 - cb.data[i]) / 10);
    const grey =
      clip01((60 - sat.data[i]) / 30) *
      clip01((190 - y) / 40) *
      clip01((y - 50) / 30);
    // Dark hair needs less texture to count (long hair reads darker than it is busy).
    return clip01(
      dark * clip01(t / 4) + strong * dark + very * clip01(reddish + grey),
    );
  });
  // Skin counts only where hair is nearby, so bare skin next to hair joins the blob.
  const hairBlur = gaussianBlur(hairness, 6 * s);
  const score = mapImage(w, h, (i) =>
    clip01(hairness.data[i] + skin.data[i] * clip01(hairBlur.data[i] / 0.2)),
  );
  const scoreBlur = gaussianBlur(score, 4 * s);
  const r = kernelRadius(15 * s);
  const m = openAtFrame(closeAtFrame(maskFrom(scoreBlur, 0.3), r), r);
  if (!m.data.includes(1)) {
    const all = createMask(w, h);
    all.data.fill(1);
    return { mask: all, skin, hairness };
  }
  // Prefer large blobs whose centroid is near the frame centre (distance in
  // width units, weighted by exp(-2 d)).
  const blob = fillHoles(
    largestComponent(m, (stat) => {
      const dx = (stat.cx - w / 2) / w;
      const dy = (stat.cy - h / 2) / w;
      return stat.area * Math.exp(-2 * Math.hypot(dx, dy));
    }),
  );
  return { mask: coreOf(blob, s), skin, hairness };
}

/**
 * Where the skin sits inside the mask: the intensity-weighted centroid of
 * gaussianBlur(skin * mask, blurSigma), in pixels of the given image. Null
 * when there is no skin inside the mask at all.
 */
export function patchCentre(
  skin: GrayImage,
  mask: Mask,
  blurSigma: number,
): { x: number; y: number } | null {
  const { width: w, height: h } = skin;
  const inside = mapImage(w, h, (i) => skin.data[i] * mask.data[i]);
  const blurred = gaussianBlur(inside, blurSigma);
  let total = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = blurred.data[y * w + x];
      total += v;
      sumX += v * x;
      sumY += v * y;
    }
  }
  if (!(total > 0)) return null;
  return { x: sumX / total, y: sumY / total };
}
