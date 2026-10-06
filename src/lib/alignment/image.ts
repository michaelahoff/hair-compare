import {
  applySimilarity,
  invertSimilarity,
  type Similarity,
} from "./transform";

/** Single-channel float image, row-major. */
export type GrayImage = { width: number; height: number; data: Float32Array };

export function createImage(width: number, height: number): GrayImage {
  return { width, height, data: new Float32Array(width * height) };
}

/** Rec. 601 luma from 8-bit RGBA (as produced by jpeg-js / canvas). */
export function rgbaToGray(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): GrayImage {
  const out = createImage(width, height);
  for (let i = 0, j = 0; i < out.data.length; i++, j += 4) {
    out.data[i] =
      (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) / 255;
  }
  return out;
}

/** Halve resolution with a 2x2 box filter. */
export function downsample(img: GrayImage): GrayImage {
  const w = img.width >> 1;
  const h = img.height >> 1;
  const out = createImage(w, h);
  const src = img.data;
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * img.width;
    const r1 = r0 + img.width;
    for (let x = 0; x < w; x++) {
      const x2 = 2 * x;
      out.data[y * w + x] =
        (src[r0 + x2] + src[r0 + x2 + 1] + src[r1 + x2] + src[r1 + x2 + 1]) / 4;
    }
  }
  return out;
}

/** Separable [1 2 1] / 4 blur, repeated `passes` times. Edges are clamped. */
export function blur(img: GrayImage, passes = 1): GrayImage {
  const { width: w, height: h } = img;
  let src = img.data;
  const tmp = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    const dst = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const l = src[row + Math.max(0, x - 1)];
        const r = src[row + Math.min(w - 1, x + 1)];
        tmp[row + x] = (l + 2 * src[row + x] + r) / 4;
      }
    }
    for (let y = 0; y < h; y++) {
      const up = Math.max(0, y - 1) * w;
      const down = Math.min(h - 1, y + 1) * w;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        dst[row + x] = (tmp[up + x] + 2 * tmp[row + x] + tmp[down + x]) / 4;
      }
    }
    src = dst;
  }
  return { width: w, height: h, data: src === img.data ? src.slice() : src };
}

/**
 * Central-difference gradient magnitude. Edges (head outline, hairline, parting)
 * survive lighting changes much better than raw intensity does.
 */
export function gradientMagnitude(img: GrayImage): GrayImage {
  const { width: w, height: h, data } = img;
  const out = createImage(w, h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = data[i + 1] - data[i - 1];
      const gy = data[i + w] - data[i - w];
      out.data[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/** Shift to zero mean and scale to unit variance. */
export function standardize(img: GrayImage): GrayImage {
  const { data } = img;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    sumSq += data[i] * data[i];
  }
  const mean = sum / data.length;
  const std = Math.sqrt(Math.max(sumSq / data.length - mean * mean, 1e-12));
  const out = createImage(img.width, img.height);
  for (let i = 0; i < data.length; i++) out.data[i] = (data[i] - mean) / std;
  return out;
}

/** Bilinear sample at pixel coordinates; NaN outside the image. */
export function sampleBilinear(img: GrayImage, x: number, y: number): number {
  const { width: w, height: h, data } = img;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return NaN;
  const x0 = Math.min(Math.floor(x), w - 2);
  const y0 = Math.min(Math.floor(y), h - 2);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * w + x0;
  const top = data[i] + (data[i + 1] - data[i]) * fx;
  const bottom = data[i + w] + (data[i + w + 1] - data[i + w]) * fx;
  return top + (bottom - top) * fy;
}

/**
 * Render `src` (the reference) as the target would see it under `t`, i.e. the
 * inverse of what the aligner recovers. Used to build synthetic test pairs.
 */
export function warpImage(
  src: GrayImage,
  t: Similarity,
  width: number,
  height: number,
  fill = 0,
): GrayImage {
  const inv = invertSimilarity(t);
  const out = createImage(width, height);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const scx = (src.width - 1) / 2;
  const scy = (src.height - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [u, v] = applySimilarity(inv, (x - cx) / width, (y - cy) / width);
      const value = sampleBilinear(
        src,
        u * src.width + scx,
        v * src.width + scy,
      );
      out.data[y * width + x] = Number.isNaN(value) ? fill : value;
    }
  }
  return out;
}
