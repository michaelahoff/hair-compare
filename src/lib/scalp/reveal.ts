/**
 * The "Reveal" view: makes fine and light hairs easier to see in a scalp
 * photo. Each pixel is compared with its own neighbourhood, so a faint strand
 * stands out from the skin around it instead of from the photo's overall
 * exposure. Colour is kept by scaling the channels together. Pure TypeScript:
 * no React, Expo or Node imports.
 */
import { createImage, downsample, type GrayImage } from "../alignment/image";
import { gaussianBlur, reflect101 } from "./image-ops";
import { createRgb, lumaOf, type RgbImage } from "./rgb";

export type RevealOptions = {
  /** Blur radius of the local mean and spread, in pixels. */
  radius?: number;
  /** Largest amplification of local detail. */
  gain?: number;
  /** Strength of the final unsharp mask. */
  sharpen?: number;
};

/** Local spread the normalisation aims for, in luma levels. */
const TARGET_STD = 40;
const DEFAULT_GAIN = 3;
const DEFAULT_SHARPEN = 0.8;
/** Blur used by the unsharp mask. */
const SHARPEN_SIGMA = 1.5;
/** A wide blur is done on a pyramid until its sigma is at most this. */
const PYRAMID_SIGMA = 3;
/** Flat areas map to this mid-grey: the output shows detail, not exposure. */
const MID_GREY = 128;

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** 2% of the width, never below 4 px, so small photos keep a usable radius. */
function defaultRadius(width: number): number {
  return Math.max(4, Math.round(0.02 * width));
}

/**
 * Samples along one axis for a bilinear resize from `src` to `dst` samples:
 * for each output sample, the two source samples to blend and the weight of
 * the second. Pixel centres are aligned. `scale` is source samples per
 * output sample; it defaults to the size ratio, but a pyramid level made by
 * dropping an odd last row or column is exactly half its parent, not
 * src / dst, and using the ratio there drifts the result toward the far edge.
 */
function linearTaps(
  src: number,
  dst: number,
  scale = src / dst,
): { lo: Int32Array; hi: Int32Array; frac: Float64Array } {
  const lo = new Int32Array(dst);
  const hi = new Int32Array(dst);
  const frac = new Float64Array(dst);
  for (let i = 0; i < dst; i++) {
    const u = Math.min(Math.max((i + 0.5) * scale - 0.5, 0), src - 1);
    const k = Math.floor(u);
    lo[i] = k;
    hi[i] = Math.min(k + 1, src - 1);
    frac[i] = u - k;
  }
  return { lo, hi, frac };
}

/** Bilinear resize of a smooth image up to width x height. */
function upsampleBilinear(
  img: GrayImage,
  width: number,
  height: number,
  scale?: number,
): GrayImage {
  const { width: sw, data: src } = img;
  const out = createImage(width, height);
  const cols = linearTaps(sw, width, scale);
  const rows = linearTaps(img.height, height, scale);
  for (let y = 0; y < height; y++) {
    const r0 = rows.lo[y] * sw;
    const r1 = rows.hi[y] * sw;
    const wy = rows.frac[y];
    for (let x = 0; x < width; x++) {
      const c0 = cols.lo[x];
      const c1 = cols.hi[x];
      const wx = cols.frac[x];
      const top = src[r0 + c0] + (src[r0 + c1] - src[r0 + c0]) * wx;
      const bottom = src[r1 + c0] + (src[r1 + c1] - src[r1 + c0]) * wx;
      out.data[y * width + x] = top + (bottom - top) * wy;
    }
  }
  return out;
}

/** `img` with `m` pixels added on each side, mirrored as gaussianBlur does. */
function padReflect(img: GrayImage, m: number): GrayImage {
  const { width: sw, height: sh, data: src } = img;
  const w = sw + 2 * m;
  const h = sh + 2 * m;
  const out = createImage(w, h);
  const cols = new Int32Array(w);
  for (let x = 0; x < w; x++) cols[x] = reflect101(x - m, sw);
  for (let y = 0; y < h; y++) {
    const row = reflect101(y - m, sh) * sw;
    for (let x = 0; x < w; x++) out.data[y * w + x] = src[row + cols[x]];
  }
  return out;
}

/**
 * Gaussian blur for a wide sigma, done on a pyramid. Each level halves the
 * resolution (2x2 box) and the sigma until the sigma is at most PYRAMID_SIGMA.
 * The smallest level gets a direct blur, then each level is brought back up
 * with bilinear upsampling. A wide blur only sees smooth content, so this
 * matches the direct blur closely at a small fraction of the cost.
 *
 * The image is first padded by the Gaussian's reach, mirrored as gaussianBlur
 * mirrors. Without that, the pyramid's own edge handling would reach the
 * picture's edge, where the error is several times larger than inside.
 *
 * Each level is exactly half its parent (an odd last row or column is
 * dropped), so the way back up uses a scale of one half, not the size ratio:
 * with the ratio, odd sizes drifted by a few pixels at the far corner.
 */
export function wideBlur(img: GrayImage, sigma: number): GrayImage {
  const m = Math.max(0, Math.ceil(3 * sigma));
  const padded = m > 0 ? padReflect(img, m) : img;
  const levels: GrayImage[] = [padded];
  let s = sigma;
  let cur = padded;
  while (s > PYRAMID_SIGMA && cur.width >= 2 && cur.height >= 2) {
    cur = downsample(cur);
    levels.push(cur);
    s /= 2;
  }
  let out = gaussianBlur(cur, s);
  for (let k = levels.length - 2; k >= 0; k--) {
    out = upsampleBilinear(out, levels[k].width, levels[k].height, 0.5);
  }
  if (m === 0) return out;
  const cropped = createImage(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    const from = (y + m) * out.width + m;
    cropped.data.set(out.data.subarray(from, from + img.width), y * img.width);
  }
  return cropped;
}

/**
 * Local contrast normalisation of a luma image, then a light unsharp mask.
 *
 * Each pixel's deviation from its local mean is scaled so the local spread
 * moves toward TARGET_STD. The scale is capped at `gain`, so a flat area (no
 * real detail) is lifted at most `gain` times and does not turn into amplified
 * noise. Busy areas get less, so their contrast is not stretched further. Flat
 * areas land on mid-grey, 128.
 */
export function revealLuma(
  luma: GrayImage,
  opts: RevealOptions = {},
): GrayImage {
  const radius = opts.radius ?? defaultRadius(luma.width);
  const gain = opts.gain ?? DEFAULT_GAIN;
  const sharpen = opts.sharpen ?? DEFAULT_SHARPEN;
  const { width, height, data } = luma;

  const mean = wideBlur(luma, radius);
  const squared = createImage(width, height);
  for (let i = 0; i < data.length; i++) {
    const d = data[i] - mean.data[i];
    squared.data[i] = d * d;
  }
  const variance = wideBlur(squared, radius);

  const out = createImage(width, height);
  for (let i = 0; i < data.length; i++) {
    const std = Math.sqrt(variance.data[i]);
    const factor = Math.min(gain, TARGET_STD / Math.max(std, 1));
    out.data[i] = MID_GREY + (data[i] - mean.data[i]) * factor;
  }

  // Unsharp mask: add back the difference from a slightly blurred copy, so
  // thin strands get a crisper edge. Clamped only once, at the end.
  const soft = gaussianBlur(out, SHARPEN_SIGMA);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = clampByte(
      out.data[i] + sharpen * (out.data[i] - soft.data[i]),
    );
  }
  return out;
}

/**
 * Reveal for a colour image. The luma change is applied to all three
 * channels by the same ratio (revealed luma over original luma), so hue and
 * saturation are kept: a grey hair stays grey and pink skin stays pink.
 * Channels are clamped to 0..255 and rounded.
 */
export function revealRgb(rgb: RgbImage, opts?: RevealOptions): RgbImage {
  const luma = lumaOf(rgb);
  const revealed = revealLuma(luma, opts);
  const out = createRgb(rgb.width, rgb.height);
  const src = rgb.data;
  const dst = out.data;
  for (let i = 0, j = 0; i < luma.data.length; i++, j += 3) {
    // Dividing by at least 1 keeps near-black pixels from blowing up.
    const ratio = revealed.data[i] / Math.max(luma.data[i], 1);
    dst[j] = Math.round(clampByte(src[j] * ratio));
    dst[j + 1] = Math.round(clampByte(src[j + 1] * ratio));
    dst[j + 2] = Math.round(clampByte(src[j + 2] * ratio));
  }
  return out;
}

/**
 * A copy of `rgb` for display. Line pixels, and their 4-neighbours so a 1-px
 * line shows as 2-3 px, are painted `color`. This wins over the mask, so a
 * line outside the analysed region still shows. Pixels where `mask` is 0 are
 * darkened to half, so the analysed region stands out. With no mask, every
 * pixel counts as analysed.
 */
export function tintLines(
  rgb: RgbImage,
  lines: Uint8Array,
  color: [number, number, number],
  mask?: Uint8Array,
): RgbImage {
  const { width: w, height: h, data: src } = rgb;
  const n = w * h;
  const painted = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (lines[y * w + x] === 0) continue;
      painted[y * w + x] = 1;
      if (x > 0) painted[y * w + x - 1] = 1;
      if (x < w - 1) painted[y * w + x + 1] = 1;
      if (y > 0) painted[(y - 1) * w + x] = 1;
      if (y < h - 1) painted[(y + 1) * w + x] = 1;
    }
  }
  const out = createRgb(w, h);
  const dst = out.data;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    if (painted[i] !== 0) {
      dst[j] = color[0];
      dst[j + 1] = color[1];
      dst[j + 2] = color[2];
    } else if (mask && mask[i] === 0) {
      dst[j] = Math.round(src[j] / 2);
      dst[j + 1] = Math.round(src[j + 1] / 2);
      dst[j + 2] = Math.round(src[j + 2] / 2);
    } else {
      dst[j] = src[j];
      dst[j + 1] = src[j + 1];
      dst[j + 2] = src[j + 2];
    }
  }
  return out;
}

/** The image as a PNG data URI; see png.ts. */
export { pngDataUri } from "./png";
