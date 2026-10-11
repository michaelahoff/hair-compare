/**
 * Hair-like line detection on greyscale images. A hair is a thin ridge: a dark
 * (or bright) line whose curvature across it is large and whose curvature along
 * it is near zero. Works from the Hessian eigenvalues of a Gaussian-blurred
 * image. Pure TypeScript: no React, Expo or Node imports.
 */
import { createImage, type GrayImage } from "../alignment/image";

/** Smaller regions give meaningless densities, so they are reported as NaN. */
const MIN_AREA_CM2 = 0.25;

/** Index into a line of length n, mirrored at both ends (reflect-101). */
function reflectIndex(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * (n - 1);
  let j = i % period;
  if (j < 0) j += period;
  return j < n ? j : period - j;
}

/** Index held inside a line of length n (replicated border). */
function clampIndex(i: number, n: number): number {
  return Math.min(Math.max(i, 0), n - 1);
}

/** Normalised 1-D Gaussian weights for offsets -radius..radius. */
function gaussianKernel(sigma: number, radius: number): Float64Array {
  const weights = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const weight = Math.exp(-(k * k) / (2 * sigma * sigma));
    weights[k + radius] = weight;
    sum += weight;
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= sum;
  return weights;
}

/**
 * Separable Gaussian blur with kernel radius ceil(3 * sigma) and reflect-101
 * borders. Filters the rows first, then the columns.
 */
function gaussianBlur(img: GrayImage, sigma: number): GrayImage {
  const { width: w, height: h, data } = img;
  const radius = Math.ceil(3 * sigma);
  if (radius < 1) return { width: w, height: h, data: data.slice() };
  const kernel = gaussianKernel(sigma, radius);
  const rows = createImage(w, h);
  const out = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += kernel[k + radius] * data[y * w + reflectIndex(x + k, w)];
      }
      rows.data[y * w + x] = sum;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += kernel[k + radius] * rows.data[reflectIndex(y + k, h) * w + x];
      }
      out.data[y * w + x] = sum;
    }
  }
  return out;
}

/**
 * Ridge strength from the Hessian eigenvalues (l1 >= l2). A dark line has a
 * large positive l1 across it; a bright line has a large negative l2. The value
 * is scaled by sigma squared and weighted by anisotropy, so blobs score low.
 */
function ridgeStrength(
  l1: number,
  l2: number,
  dark: boolean,
  sigmaSq: number,
): number {
  const across = dark ? l1 : -l2;
  const anisotropy = Math.abs(l1 - l2) / (Math.abs(l1) + Math.abs(l2) + 1e-6);
  return Math.max(0, across) * sigmaSq * anisotropy;
}

/**
 * Line strength and across-line direction at one scale. `dark` picks dark
 * lines on a brighter background; otherwise bright lines are found. theta is
 * in radians, measured from +x towards +y, and points across the line.
 */
export function hessianRidge(
  img: GrayImage,
  sigma: number,
  dark: boolean,
): { response: GrayImage; theta: GrayImage } {
  const { width: w, height: h } = img;
  const g = gaussianBlur(img, sigma).data;
  const response = createImage(w, h);
  const theta = createImage(w, h);
  const sigmaSq = sigma * sigma;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const up = clampIndex(y - 1, h) * w;
    const down = clampIndex(y + 1, h) * w;
    for (let x = 0; x < w; x++) {
      const left = clampIndex(x - 1, w);
      const right = clampIndex(x + 1, w);
      const centre = g[row + x];
      const dxx = g[row + right] - 2 * centre + g[row + left];
      const dyy = g[down + x] - 2 * centre + g[up + x];
      const dxy =
        (g[down + right] - g[down + left] - g[up + right] + g[up + left]) / 4;
      const half = (dxx + dyy) / 2;
      const det = Math.sqrt(((dxx - dyy) / 2) ** 2 + dxy * dxy);
      response.data[row + x] = ridgeStrength(
        half + det,
        half - det,
        dark,
        sigmaSq,
      );
      theta.data[row + x] = 0.5 * Math.atan2(2 * dxy, dxx - dyy);
    }
  }
  return { response, theta };
}

/**
 * Strongest response over several scales. Each pixel takes its value and its
 * theta from the scale that responds most there.
 */
export function multiRidge(
  img: GrayImage,
  sigmas: number[],
  dark: boolean,
): { response: GrayImage; theta: GrayImage } {
  const best = createImage(img.width, img.height);
  const theta = createImage(img.width, img.height);
  for (const sigma of sigmas) {
    const scale = hessianRidge(img, sigma, dark);
    for (let i = 0; i < best.data.length; i++) {
      if (scale.response.data[i] > best.data[i]) {
        best.data[i] = scale.response.data[i];
        theta.data[i] = scale.theta.data[i];
      }
    }
  }
  return { response: best, theta };
}

/** Bilinear sample at pixel coordinates; 0 outside the image. */
function sampleOrZero(img: GrayImage, x: number, y: number): number {
  const { width: w, height: h, data } = img;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
  const bottom = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Ridge centres: 1 where a pixel's response is above zero and at least the
 * response one pixel away along +theta and along -theta (across the line).
 * Samples outside the image count as 0, and flat zero background is never a
 * ridge centre.
 */
export function nonMaxSuppress(
  response: GrayImage,
  theta: GrayImage,
): Uint8Array {
  const { width: w, height: h, data } = response;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = Math.cos(theta.data[i]);
      const dy = Math.sin(theta.data[i]);
      const ahead = sampleOrZero(response, x + dx, y + dy);
      const behind = sampleOrZero(response, x - dx, y - dy);
      out[i] = data[i] > 0 && data[i] >= ahead && data[i] >= behind ? 1 : 0;
    }
  }
  return out;
}

/**
 * One-pixel-wide line centres that are also stronger than `threshold`. If a
 * mask is given, only pixels where it is set can pass.
 */
export function thinLines(
  response: GrayImage,
  theta: GrayImage,
  threshold: number,
  mask?: Uint8Array,
): Uint8Array {
  const out = nonMaxSuppress(response, theta);
  for (let i = 0; i < out.length; i++) {
    const strong = response.data[i] > threshold;
    const allowed = mask === undefined || mask[i] !== 0;
    out[i] = out[i] !== 0 && strong && allowed ? 1 : 0;
  }
  return out;
}

/** Calls `visit` with the index of each in-bounds pixel around (x, y), not (x, y) itself. */
function forEachNeighbour(
  width: number,
  height: number,
  x: number,
  y: number,
  visit: (index: number) => void,
): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      visit(ny * width + nx);
    }
  }
}

/**
 * Indices of the 8-connected set pixels that form one component with `start`.
 * Pixels found are marked in `seen` so the caller does not visit them again.
 */
function component(
  mask: Uint8Array,
  width: number,
  height: number,
  start: number,
  seen: Uint8Array,
): number[] {
  const pixels: number[] = [];
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const i = stack.pop() as number;
    pixels.push(i);
    const x = i % width;
    const y = (i - x) / width;
    forEachNeighbour(width, height, x, y, (j) => {
      if (mask[j] !== 0 && seen[j] === 0) {
        seen[j] = 1;
        stack.push(j);
      }
    });
  }
  return pixels;
}

/** Keeps only the 8-connected line pieces with at least `minPixels` pixels. */
export function removeShort(
  lines: Uint8Array,
  width: number,
  height: number,
  minPixels: number,
): Uint8Array {
  const out = new Uint8Array(lines.length);
  const seen = new Uint8Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 0 || seen[i] !== 0) continue;
    const pixels = component(lines, width, height, i, seen);
    if (pixels.length >= minPixels) {
      for (const j of pixels) out[j] = 1;
    }
  }
  return out;
}

/**
 * Cuts the line mask at junctions. A junction is a line pixel with three or
 * more line neighbours; it and its 8 neighbours are removed. Returns the
 * remaining mask and the pixel count of each 8-connected piece left.
 */
export function splitAtJunctions(
  lines: Uint8Array,
  width: number,
  height: number,
): { pieces: Uint8Array; lengths: number[] } {
  const junctions: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (lines[i] === 0) continue;
      let neighbours = 0;
      forEachNeighbour(width, height, x, y, (j) => {
        if (lines[j] !== 0) neighbours++;
      });
      if (neighbours >= 3) junctions.push(i);
    }
  }
  const pieces = lines.slice();
  for (const i of junctions) {
    const x = i % width;
    const y = (i - x) / width;
    pieces[i] = 0;
    forEachNeighbour(width, height, x, y, (j) => {
      pieces[j] = 0;
    });
  }
  const seen = new Uint8Array(pieces.length);
  const lengths: number[] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i] === 0 || seen[i] !== 0) continue;
    lengths.push(component(pieces, width, height, i, seen).length);
  }
  return { pieces, lengths };
}

/**
 * Line length and area inside `region`, in cm, and their ratio (cm of line per
 * cm²). Length is a plain pixel count, not a true length, so it depends on how
 * the lines are rasterised: about 10% low for ideal 8-connected lines, and high
 * for staircased ones. `pxPerCm` must be positive. Density is NaN when the area
 * is under 0.25 cm².
 */
export function lineDensity(
  lines: Uint8Array,
  region: Uint8Array,
  width: number,
  height: number,
  pxPerCm: number,
): { lengthCm: number; areaCm2: number; density: number } {
  let linePx = 0;
  let regionPx = 0;
  for (let i = 0; i < width * height; i++) {
    if (region[i] === 0) continue;
    regionPx++;
    if (lines[i] !== 0) linePx++;
  }
  const lengthCm = linePx / pxPerCm;
  const areaCm2 = regionPx / (pxPerCm * pxPerCm);
  const density = areaCm2 < MIN_AREA_CM2 ? Number.NaN : lengthCm / areaCm2;
  return { lengthCm, areaCm2, density };
}

/**
 * Stereological cross-check of line density. Counts the starts of line runs
 * (0-to-1 steps, with pixels outside `region` treated as empty) along every
 * stepPx-th row inside `region`, and returns (pi / 2) * crossings / test length
 * in cm, an estimate of line length per cm². It assumes lines point in all
 * directions equally. Only horizontal test lines are used, so oriented hair
 * will be biased. Runs that touch or cross on one row count once, so dense
 * crossing fields read low. Returns NaN when no region pixel is sampled.
 */
export function transectDensity(
  lines: Uint8Array,
  region: Uint8Array,
  width: number,
  height: number,
  pxPerCm: number,
  stepPx: number,
): number {
  const step = Math.max(1, Math.floor(stepPx));
  let crossings = 0;
  let sampledPx = 0;
  for (let y = 0; y < height; y += step) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (region[row + x] === 0) continue;
      sampledPx++;
      const runStart =
        x === 0 || region[row + x - 1] === 0 || lines[row + x - 1] === 0;
      if (runStart && lines[row + x] !== 0) crossings++;
    }
  }
  if (sampledPx === 0) return Number.NaN;
  return ((Math.PI / 2) * crossings) / (sampledPx / pxPerCm);
}
