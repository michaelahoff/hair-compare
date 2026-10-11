/**
 * Reading real photos for offline evaluation under bun: decode a JPEG, shrink
 * it by area averaging, and write greyscale or RGB results back as JPEG.
 * Development only; never imported by the app.
 */
import { readFileSync, writeFileSync } from "node:fs";
import decode from "jpeg-js/lib/decoder";
import { encode } from "jpeg-js";
import { createImage, type GrayImage } from "../../src/lib/alignment/image";

export type RgbImage = { width: number; height: number; data: Uint8Array };

const cache = new Map<string, RgbImage>();

/** Decode a JPEG to RGB bytes (3 per pixel). Cached by path. */
export function readRgb(path: string): RgbImage {
  const hit = cache.get(path);
  if (hit) return hit;
  const decoded = decode(readFileSync(path), {
    useTArray: true,
    maxResolutionInMP: 40,
  });
  const n = decoded.width * decoded.height;
  const data = new Uint8Array(n * 3);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    data[i * 3] = decoded.data[j];
    data[i * 3 + 1] = decoded.data[j + 1];
    data[i * 3 + 2] = decoded.data[j + 2];
  }
  const out = { width: decoded.width, height: decoded.height, data };
  cache.set(path, out);
  return out;
}

/** Area-average an RGB image to `width` pixels wide, keeping its aspect. */
export function resizeRgb(img: RgbImage, width: number): RgbImage {
  const height = Math.max(1, Math.round((img.height * width) / img.width));
  const out = new Uint8Array(width * height * 3);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * img.width + x0) * 3;
        for (let xx = x0; xx < x1; xx++, i += 3) {
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          n++;
        }
      }
      const o = (y * width + x) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  }
  return { width, height, data: out };
}

/** Rec. 601 luma, 0..1, as `rgbaToGray` computes it. */
export function toGray(img: RgbImage): GrayImage {
  const out = createImage(img.width, img.height);
  for (let i = 0, j = 0; i < out.data.length; i++, j += 3) {
    out.data[i] =
      (0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2]) /
      255;
  }
  return out;
}

/** A photo as the app's `grayPhoto` reads it: `width` pixels wide, greyscale. */
export function grayAt(path: string, width: number): GrayImage {
  return toGray(resizeRgb(readRgb(path), width));
}

export function writeJpeg(path: string, img: RgbImage, quality = 90) {
  const n = img.width * img.height;
  const rgba = new Uint8Array(n * 4);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    rgba[i * 4] = img.data[j];
    rgba[i * 4 + 1] = img.data[j + 1];
    rgba[i * 4 + 2] = img.data[j + 2];
    rgba[i * 4 + 3] = 255;
  }
  const jpeg = encode({ data: rgba, width: img.width, height: img.height }, quality);
  writeFileSync(path, jpeg.data);
}

/** Greyscale (0..1, clamped) to RGB bytes. */
export function grayToRgb(img: GrayImage): RgbImage {
  const data = new Uint8Array(img.width * img.height * 3);
  for (let i = 0; i < img.data.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(img.data[i] * 255)));
    data[i * 3] = v;
    data[i * 3 + 1] = v;
    data[i * 3 + 2] = v;
  }
  return { width: img.width, height: img.height, data };
}

/** Lay RGB images of equal height side by side with a thin gap. */
export function hstack(images: RgbImage[], gap = 4): RgbImage {
  const height = Math.max(...images.map((i) => i.height));
  const width =
    images.reduce((sum, i) => sum + i.width, 0) + gap * (images.length - 1);
  const data = new Uint8Array(width * height * 3).fill(40);
  let x0 = 0;
  for (const img of images) {
    for (let y = 0; y < img.height; y++) {
      data.set(
        img.data.subarray(y * img.width * 3, (y + 1) * img.width * 3),
        (y * width + x0) * 3,
      );
    }
    x0 += img.width + gap;
  }
  return { width, height, data };
}

export function vstack(images: RgbImage[], gap = 4): RgbImage {
  const width = Math.max(...images.map((i) => i.width));
  const height =
    images.reduce((sum, i) => sum + i.height, 0) + gap * (images.length - 1);
  const data = new Uint8Array(width * height * 3).fill(40);
  let y0 = 0;
  for (const img of images) {
    for (let y = 0; y < img.height; y++) {
      data.set(
        img.data.subarray(y * img.width * 3, (y + 1) * img.width * 3),
        ((y0 + y) * width) * 3,
      );
    }
    y0 += img.height + gap;
  }
  return { width, height, data };
}
