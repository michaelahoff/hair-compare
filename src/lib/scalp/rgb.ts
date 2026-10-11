/**
 * 8-bit RGB pixels (3 bytes a pixel, row-major) and the colour channels the
 * scalp analysis reads from them. Pure functions: no React or Expo imports,
 * so they run under `bun test` and on the device alike.
 */
import { createImage, type GrayImage } from "../alignment/image";

export type RgbImage = { width: number; height: number; data: Uint8Array };

export function createRgb(width: number, height: number): RgbImage {
  return { width, height, data: new Uint8Array(width * height * 3) };
}

/** RGBA bytes (as jpeg-js and canvas give them) to RGB. */
export function rgbFromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): RgbImage {
  const out = createRgb(width, height);
  for (let i = 0, j = 0, k = 0; i < width * height; i++, j += 4, k += 3) {
    out.data[k] = rgba[j];
    out.data[k + 1] = rgba[j + 1];
    out.data[k + 2] = rgba[j + 2];
  }
  return out;
}

/** Rec. 601 luma, 0..255 as a float image. */
export function lumaOf(rgb: RgbImage): GrayImage {
  const out = createImage(rgb.width, rgb.height);
  const d = rgb.data;
  for (let i = 0, j = 0; i < out.data.length; i++, j += 3)
    out.data[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
  return out;
}

/**
 * YCbCr chroma as OpenCV's YCrCb conversion gives it for 8-bit input:
 * Cr = 128 + 0.713 (R - Y), Cb = 128 + 0.564 (B - Y). Both 0..255.
 */
export function chromaOf(rgb: RgbImage): { cr: GrayImage; cb: GrayImage } {
  const cr = createImage(rgb.width, rgb.height);
  const cb = createImage(rgb.width, rgb.height);
  const d = rgb.data;
  for (let i = 0, j = 0; i < cr.data.length; i++, j += 3) {
    const y = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    cr.data[i] = 128 + 0.713 * (d[j] - y);
    cb.data[i] = 128 + 0.564 * (d[j + 2] - y);
  }
  return { cr, cb };
}

/** HSV saturation as OpenCV scales it for 8-bit input: 0..255. */
export function saturationOf(rgb: RgbImage): GrayImage {
  const out = createImage(rgb.width, rgb.height);
  const d = rgb.data;
  for (let i = 0, j = 0; i < out.data.length; i++, j += 3) {
    const max = Math.max(d[j], d[j + 1], d[j + 2]);
    const min = Math.min(d[j], d[j + 1], d[j + 2]);
    out.data[i] = max === 0 ? 0 : (255 * (max - min)) / max;
  }
  return out;
}

/** Area-average an RGB image to `width` pixels wide, keeping its aspect. */
export function resizeRgb(img: RgbImage, width: number): RgbImage {
  if (width >= img.width) return img;
  const height = Math.max(1, Math.round((img.height * width) / img.width));
  const out = createRgb(width, height);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(img.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(img.width, Math.floor((x + 1) * sx)));
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
      out.data[o] = r / n;
      out.data[o + 1] = g / n;
      out.data[o + 2] = b / n;
    }
  }
  return out;
}

/** The pixels inside a box, as a new image. The box is clamped to the image. */
export function cropRgb(
  img: RgbImage,
  x0: number,
  y0: number,
  width: number,
  height: number,
): RgbImage {
  const cx0 = Math.max(0, Math.floor(x0));
  const cy0 = Math.max(0, Math.floor(y0));
  const cx1 = Math.min(img.width, Math.ceil(x0 + width));
  const cy1 = Math.min(img.height, Math.ceil(y0 + height));
  const out = createRgb(Math.max(0, cx1 - cx0), Math.max(0, cy1 - cy0));
  for (let y = cy0; y < cy1; y++)
    out.data.set(
      img.data.subarray((y * img.width + cx0) * 3, (y * img.width + cx1) * 3),
      (y - cy0) * out.width * 3,
    );
  return out;
}
