/**
 * Pictures of how two photos line up under a transform: the target, the
 * reference warped onto it, a checkerboard of the two, and a 50% blend.
 */
import { sampleBilinear, type GrayImage } from "../../src/lib/alignment/image";
import {
  applySimilarity,
  invertSimilarity,
  type Similarity,
} from "../../src/lib/alignment/transform";
import { hstack, type RgbImage } from "./images";

/**
 * Warp `ref` (RGB) into the target's frame under `t` (ref → target, in each
 * image's width-normalised units), rendered `width` wide at the target's
 * aspect ratio. Pixels the reference doesn't reach are dark grey.
 */
export function warpRgb(
  ref: RgbImage,
  t: Similarity,
  width: number,
  height: number,
): RgbImage {
  const inv = invertSimilarity(t);
  const out = new Uint8Array(width * height * 3).fill(48);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const scx = (ref.width - 1) / 2;
  const scy = (ref.height - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [u, v] = applySimilarity(inv, (x - cx) / width, (y - cy) / width);
      const sx = u * ref.width + scx;
      const sy = v * ref.width + scy;
      if (sx < 0 || sy < 0 || sx > ref.width - 1 || sy > ref.height - 1)
        continue;
      const x0 = Math.min(Math.floor(sx), ref.width - 2);
      const y0 = Math.min(Math.floor(sy), ref.height - 2);
      const fx = sx - x0;
      const fy = sy - y0;
      const o = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        const i = (y0 * ref.width + x0) * 3 + c;
        const top = ref.data[i] + (ref.data[i + 3] - ref.data[i]) * fx;
        const j = i + ref.width * 3;
        const bottom = ref.data[j] + (ref.data[j + 3] - ref.data[j]) * fx;
        out[o + c] = top + (bottom - top) * fy;
      }
    }
  }
  return { width, height, data: out };
}

export function checker(a: RgbImage, b: RgbImage, cell = 32): RgbImage {
  const out = new Uint8Array(a.data.length);
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const src = ((x / cell) | 0) + ((y / cell) | 0) & 1 ? b : a;
      const o = (y * a.width + x) * 3;
      out[o] = src.data[o];
      out[o + 1] = src.data[o + 1];
      out[o + 2] = src.data[o + 2];
    }
  return { width: a.width, height: a.height, data: out };
}

export function blend(a: RgbImage, b: RgbImage): RgbImage {
  const out = new Uint8Array(a.data.length);
  for (let i = 0; i < out.length; i++) out[i] = (a.data[i] + b.data[i]) >> 1;
  return { width: a.width, height: a.height, data: out };
}

/** target | warped ref | checker | blend */
export function overlaySheet(
  target: RgbImage,
  ref: RgbImage,
  t: Similarity,
): RgbImage {
  const warped = warpRgb(ref, t, target.width, target.height);
  return hstack([target, warped, checker(target, warped), blend(target, warped)]);
}

/** Draw a small filled square at pixel (x, y). */
export function dot(img: RgbImage, x: number, y: number, rgb: [number, number, number], r = 3) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      img.data.set(rgb, (py * img.width + px) * 3);
    }
}

export { sampleBilinear, type GrayImage };
