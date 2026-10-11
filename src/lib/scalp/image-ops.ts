/**
 * Pure image operations for the scalp analysis: Gaussian blur, local texture,
 * binary masks (morphology, components, hole filling, distance) and area
 * resizing. Works on the same row-major GrayImage as the alignment code.
 * Pure TypeScript: no React, Expo or Node imports.
 */
import { createImage, type GrayImage } from "../alignment/image";

/** Binary mask, row-major. 1 is inside, 0 is outside. */
export type Mask = { width: number; height: number; data: Uint8Array };

/** Bounding box and centroid of one component. x1 and y1 are inclusive. */
export type ComponentStat = {
  area: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
};

export type Components = {
  count: number;
  /** 0 for background, 1..count for the component each pixel belongs to. */
  labels: Int32Array;
  /** stats[k] describes label k + 1. */
  stats: ComponentStat[];
};

/** Distance reported when a mask has no outside pixel at all. */
const NO_OUTSIDE_DISTANCE = 1e6;

/**
 * Stand-in for infinity inside the distance transform. Large enough that a
 * real distance always wins a minimum, and finite so the arithmetic stays
 * well-defined.
 */
const UNREACHABLE = 1e20;

/**
 * Index into a line of n samples, mirrored at the ends without repeating the
 * end sample. This is OpenCV's BORDER_REFLECT_101: index -1 reads index 1.
 * Using the same rule keeps results comparable with OpenCV output.
 */
export function reflect101(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * (n - 1);
  const m = ((i % period) + period) % period;
  return m < n ? m : period - m;
}

/** Normalised 1-D Gaussian weights for offsets -r..r, where r = ceil(3 sigma). */
function gaussianTaps(sigma: number): Float64Array {
  const r = Math.ceil(3 * sigma);
  const taps = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let k = -r; k <= r; k++) {
    const weight = Math.exp(-(k * k) / (2 * sigma * sigma));
    taps[k + r] = weight;
    sum += weight;
  }
  for (let i = 0; i < taps.length; i++) taps[i] /= sum;
  return taps;
}

/**
 * One separable pass. Filters every row (horizontal) or every column
 * (vertical) of src into dst. The reflected source offset for each position
 * and tap is worked out once per line length, not once per pixel.
 */
function convolveAxis(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  taps: Float64Array,
  horizontal: boolean,
): void {
  const k = taps.length;
  const r = (k - 1) / 2;
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 1 : w;
  const lineStep = horizontal ? w : 1;
  const offset = new Int32Array(len * k);
  for (let i = 0; i < len; i++) {
    for (let j = 0; j < k; j++) {
      offset[i * k + j] = reflect101(i + j - r, len) * step;
    }
  }
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep;
    for (let i = 0; i < len; i++) {
      let sum = 0;
      for (let j = 0; j < k; j++) {
        sum += taps[j] * src[base + offset[i * k + j]];
      }
      dst[base + i * step] = sum;
    }
  }
}

/**
 * Separable Gaussian blur with kernel radius ceil(3 sigma) and reflect-101
 * borders, matching OpenCV's default. A sigma of zero or less returns a copy.
 */
export function gaussianBlur(img: GrayImage, sigma: number): GrayImage {
  const { width: w, height: h } = img;
  if (!(sigma > 0)) {
    return { width: w, height: h, data: img.data.slice() };
  }
  const taps = gaussianTaps(sigma);
  const tmp = new Float32Array(img.data.length);
  const out = createImage(w, h);
  convolveAxis(img.data, tmp, w, h, taps, true);
  convolveAxis(tmp, out.data, w, h, taps, false);
  return out;
}

/**
 * Fine-texture measure: the local standard deviation of what a `fine`-sigma
 * blur removes, averaged over a `window`-sigma neighbourhood. Smooth skin and
 * the flat background score near zero; hair strands and their shadows score
 * high. Non-negative by construction, since the weights are all positive.
 */
export function localStd(
  img: GrayImage,
  fine: number,
  window: number,
): GrayImage {
  const detail = gaussianBlur(img, fine);
  const squared = createImage(img.width, img.height);
  for (let i = 0; i < squared.data.length; i++) {
    const d = img.data[i] - detail.data[i];
    squared.data[i] = d * d;
  }
  const local = gaussianBlur(squared, window);
  for (let i = 0; i < local.data.length; i++) {
    local.data[i] = Math.sqrt(local.data[i]);
  }
  return local;
}

export function createMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

/** Pixels strictly above `threshold` become inside. */
export function maskFrom(img: GrayImage, threshold: number): Mask {
  const out = createMask(img.width, img.height);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = img.data[i] > threshold ? 1 : 0;
  }
  return out;
}

/**
 * Half-width of the disc on each row. For row offset dy (stored at index
 * dy + r), the disc covers dx in [-hw, hw] where dx*dx + dy*dy <= r*r. The
 * test uses integers only, so the rim has no rounding error.
 */
function discRows(r: number): Int32Array {
  const rows = new Int32Array(2 * r + 1);
  for (let dy = -r; dy <= r; dy++) {
    let hw = 0;
    while ((hw + 1) * (hw + 1) + dy * dy <= r * r) hw++;
    rows[dy + r] = hw;
  }
  return rows;
}

/** Radius as a whole number of pixels; negative values count as zero. */
function wholeRadius(radius: number): number {
  return Math.max(0, Math.round(radius));
}

/** True if every pixel of the disc centred at (x, y) is inside the mask. */
function discFits(
  mask: Mask,
  x: number,
  y: number,
  r: number,
  rows: Int32Array,
): boolean {
  const { width: w, height: h, data } = mask;
  for (let dy = -r; dy <= r; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= h) return false;
    const hw = rows[dy + r];
    for (let dx = -hw; dx <= hw; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= w || data[yy * w + xx] === 0) return false;
    }
  }
  return true;
}

/** True if any pixel of the disc centred at (x, y) is inside the mask. */
function discTouches(
  mask: Mask,
  x: number,
  y: number,
  r: number,
  rows: Int32Array,
): boolean {
  const { width: w, height: h, data } = mask;
  for (let dy = -r; dy <= r; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= h) continue;
    const hw = rows[dy + r];
    for (let dx = -hw; dx <= hw; dx++) {
      const xx = x + dx;
      if (xx >= 0 && xx < w && data[yy * w + xx] !== 0) return true;
    }
  }
  return false;
}

/**
 * Radius up to which the direct disc test is used. On 1000 x 1000 masks it is
 * faster only at radius 1. The distance transform costs about 17 ms at any
 * radius, while the direct test grows with the disc.
 */
const DIRECT_MAX_RADIUS = 1;

/**
 * Keeps a pixel only if the whole disc of the given radius around it is
 * inside. Pixels outside the image count as 0, so the mask shrinks at the
 * image edge too. Larger radii use the distance transform: a pixel survives
 * exactly when its nearest outside pixel is farther away than the radius.
 */
export function erode(mask: Mask, radius: number): Mask {
  const r = wholeRadius(radius);
  if (r > DIRECT_MAX_RADIUS) return erodeByDistance(mask, r);
  const rows = discRows(r);
  const out = createMask(mask.width, mask.height);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      out.data[y * mask.width + x] = discFits(mask, x, y, r, rows) ? 1 : 0;
    }
  }
  return out;
}

/**
 * Sets a pixel if any pixel of the disc around it is inside. The disc is
 * symmetric, so sampling at +offset is the same as sampling at -offset.
 * Outside the image counts as 0. Larger radii use the distance transform: a
 * pixel is set exactly when its nearest inside pixel is within the radius.
 */
export function dilate(mask: Mask, radius: number): Mask {
  const r = wholeRadius(radius);
  if (r > DIRECT_MAX_RADIUS) return dilateByDistance(mask, r);
  const rows = discRows(r);
  const out = createMask(mask.width, mask.height);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      out.data[y * mask.width + x] = discTouches(mask, x, y, r, rows) ? 1 : 0;
    }
  }
  return out;
}

/**
 * Erosion through the distance transform. Outside the image counts as 0, so
 * the mask is first padded with a ring of zeros. The nearest point outside a
 * rectangle always lies on the ring just beyond its edge, so one ring gives
 * the exact distance to everything outside the image.
 */
function erodeByDistance(mask: Mask, r: number): Mask {
  const { width: w, height: h } = mask;
  const pw = w + 2;
  const padded = createMask(pw, h + 2);
  for (let y = 0; y < h; y++) {
    padded.data.set(mask.data.subarray(y * w, (y + 1) * w), (y + 1) * pw + 1);
  }
  const sq = squaredDistances(padded);
  const r2 = r * r;
  const out = createMask(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out.data[y * w + x] = sq[(y + 1) * pw + x + 1] > r2 ? 1 : 0;
    }
  }
  return out;
}

/**
 * Dilation through the distance transform. Only inside pixels of the image
 * count, so no padding is needed: the distance is taken to the nearest inside
 * pixel, by running the transform on the complement.
 */
function dilateByDistance(mask: Mask, r: number): Mask {
  const { width: w, height: h, data } = mask;
  const complement = createMask(w, h);
  for (let i = 0; i < data.length; i++) {
    complement.data[i] = data[i] !== 0 ? 0 : 1;
  }
  const sq = squaredDistances(complement);
  const r2 = r * r;
  const out = createMask(w, h);
  for (let i = 0; i < data.length; i++) out.data[i] = sq[i] <= r2 ? 1 : 0;
  return out;
}

/** Erode then dilate: removes specks and thin spurs smaller than the disc. */
export function open(mask: Mask, radius: number): Mask {
  return dilate(erode(mask, radius), radius);
}

/** Dilate then erode: fills gaps and notches smaller than the disc. */
export function close(mask: Mask, radius: number): Mask {
  return erode(dilate(mask, radius), radius);
}

/**
 * Labels the inside pixels by flood fill. An explicit stack replaces
 * recursion, so large regions cannot overflow the call stack. A pixel is
 * marked when it is pushed, so each pixel enters the stack at most once.
 * connectivity 4 joins only edge neighbours; 8 also joins diagonals.
 */
export function connectedComponents(
  mask: Mask,
  connectivity: 4 | 8,
): Components {
  const { width: w, height: h, data } = mask;
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const stats: ComponentStat[] = [];
  for (let seed = 0; seed < data.length; seed++) {
    if (data[seed] === 0 || labels[seed] !== 0) continue;
    const label = stats.length + 1;
    const seedX = seed % w;
    const seedY = (seed - seedX) / w;
    const stat: ComponentStat = {
      area: 0,
      x0: seedX,
      y0: seedY,
      x1: seedX,
      y1: seedY,
      cx: 0,
      cy: 0,
    };
    let sumX = 0;
    let sumY = 0;
    let top = 0;
    labels[seed] = label;
    stack[top++] = seed;
    while (top > 0) {
      const p = stack[--top];
      const px = p % w;
      const py = (p - px) / w;
      stat.area++;
      sumX += px;
      sumY += py;
      stat.x0 = Math.min(stat.x0, px);
      stat.x1 = Math.max(stat.x1, px);
      stat.y0 = Math.min(stat.y0, py);
      stat.y1 = Math.max(stat.y1, py);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (connectivity === 4 && dx !== 0 && dy !== 0) continue;
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (data[q] === 0 || labels[q] !== 0) continue;
          labels[q] = label;
          stack[top++] = q;
        }
      }
    }
    stat.cx = sumX / stat.area;
    stat.cy = sumY / stat.area;
    stats.push(stat);
  }
  return { count: stats.length, labels, stats };
}

/**
 * Turns every background region that does not touch the image border into
 * inside. Background is flooded from the border with 4-connectivity; whatever
 * background the flood never reaches is an enclosed hole.
 */
export function fillHoles(mask: Mask): Mask {
  const { width: w, height: h, data } = mask;
  const reached = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const visit = (i: number) => {
    if (data[i] === 0 && reached[i] === 0) {
      reached[i] = 1;
      stack[top++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    visit(x);
    visit((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    visit(y * w);
    visit(y * w + w - 1);
  }
  while (top > 0) {
    const p = stack[--top];
    const px = p % w;
    if (px > 0) visit(p - 1);
    if (px < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < (h - 1) * w) visit(p + w);
  }
  const out = createMask(w, h);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = data[i] !== 0 || reached[i] === 0 ? 1 : 0;
  }
  return out;
}

/**
 * Squared distance transform of one line, by the Felzenszwalb & Huttenlocher
 * lower envelope of parabolas: out[q] = min over p of (q - p)^2 + f[p]. Runs
 * in linear time. v, z are scratch buffers of length at least n and n + 1.
 */
function squaredDistance1d(
  f: Float64Array,
  n: number,
  out: Float64Array,
  v: Int32Array,
  z: Float64Array,
): void {
  if (n === 0) return;
  const crossing = (q: number, p: number) =>
    (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = crossing(q, v[k]);
    while (s <= z[k]) {
      k--;
      s = crossing(q, v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const d = q - v[k];
    out[q] = d * d + f[v[k]];
  }
}

/**
 * Squared distance from each pixel to the nearest outside pixel (value 0),
 * exact because every value is an integer. The image edge is not outside. A
 * mask with no outside pixel gets Infinity everywhere. Two 1-D passes:
 * columns, then rows.
 */
function squaredDistances(mask: Mask): Float64Array {
  const { width: w, height: h, data } = mask;
  if (!data.includes(0)) return new Float64Array(w * h).fill(Infinity);
  const n = Math.max(w, h);
  const line = new Float64Array(n);
  const envelope = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const sq = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      line[y] = data[y * w + x] === 0 ? 0 : UNREACHABLE;
    }
    squaredDistance1d(line, h, envelope, v, z);
    for (let y = 0; y < h; y++) sq[y * w + x] = envelope[y];
  }
  // Each row is copied into `line` before its envelope is written back, so
  // the result can overwrite the column values in place.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) line[x] = sq[y * w + x];
    squaredDistance1d(line, w, envelope, v, z);
    for (let x = 0; x < w; x++) sq[y * w + x] = envelope[x];
  }
  return sq;
}

/**
 * Distance from each inside pixel to the nearest outside pixel, Euclidean and
 * exact (squared distances, then sqrt). Outside pixels inside the image get 0.
 * The image edge is not treated as outside, so an inside pixel next to the
 * border keeps its real distance. A mask with no outside pixel at all gets
 * NO_OUTSIDE_DISTANCE everywhere.
 */
export function distanceTransform(mask: Mask): GrayImage {
  const { width: w, height: h, data } = mask;
  const out = createImage(w, h);
  if (!data.includes(0)) {
    out.data.fill(NO_OUTSIDE_DISTANCE);
    return out;
  }
  const sq = squaredDistances(mask);
  for (let i = 0; i < sq.length; i++) out.data[i] = Math.sqrt(sq[i]);
  return out;
}

/**
 * Keeps only the single component with the highest `prefer(stat)`. The
 * default prefers the largest area. Ties go to the component found first in
 * row-major order. Uses 8-connectivity.
 */
export function largestComponent(
  mask: Mask,
  prefer?: (stat: ComponentStat) => number,
): Mask {
  const { labels, stats } = connectedComponents(mask, 8);
  let best = 0;
  let bestScore = -Infinity;
  for (let k = 0; k < stats.length; k++) {
    const score = prefer ? prefer(stats[k]) : stats[k].area;
    if (score > bestScore) {
      bestScore = score;
      best = k + 1;
    }
  }
  const out = createMask(mask.width, mask.height);
  if (best === 0) return out;
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = labels[i] === best ? 1 : 0;
  }
  return out;
}

/** Source samples one output cell covers, with each sample's share (sums to 1). */
type Tap = { index: number; weight: number };

/**
 * For each output cell along one axis, the source samples it overlaps and
 * how much of each. A source sample that straddles a cell edge is split
 * between the two cells in proportion to the overlap.
 */
function areaTaps(srcLen: number, outLen: number): Tap[][] {
  const scale = srcLen / outLen;
  const cells: Tap[][] = [];
  for (let j = 0; j < outLen; j++) {
    const start = j * scale;
    const end = (j + 1) * scale;
    const taps: Tap[] = [];
    for (let i = Math.floor(start); i < end && i < srcLen; i++) {
      const overlap = Math.min(end, i + 1) - Math.max(start, i);
      if (overlap > 0) taps.push({ index: i, weight: overlap / scale });
    }
    cells.push(taps);
  }
  return cells;
}

/**
 * Bilinear sample at (x, y), clamped to the image. Written here rather than
 * reusing sampleBilinear because that one returns NaN on images that are a
 * single pixel wide or high.
 */
function bilinear(img: GrayImage, x: number, y: number): number {
  const { width: w, height: h, data } = img;
  const cx = Math.min(Math.max(x, 0), w - 1);
  const cy = Math.min(Math.max(y, 0), h - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const top = data[y0 * w + x0] + (data[y0 * w + x1] - data[y0 * w + x0]) * fx;
  const bottom =
    data[y1 * w + x0] + (data[y1 * w + x1] - data[y1 * w + x0]) * fx;
  return top + (bottom - top) * fy;
}

/**
 * Resizes to `width` pixels wide, keeping the aspect ratio (height is
 * rounded). Downscaling averages the source area each output pixel covers,
 * so fine detail is not aliased into noise. Upscaling, or keeping the same
 * width, uses bilinear sampling instead.
 */
export function resizeArea(img: GrayImage, width: number): GrayImage {
  const { width: srcW, height: srcH } = img;
  const height = Math.max(1, Math.round((srcH * width) / srcW));
  const out = createImage(width, height);
  if (width >= srcW) {
    const sx = srcW / width;
    const sy = srcH / height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        out.data[y * width + x] = bilinear(
          img,
          (x + 0.5) * sx - 0.5,
          (y + 0.5) * sy - 0.5,
        );
      }
    }
    return out;
  }
  const cols = areaTaps(srcW, width);
  const rows = areaTaps(srcH, height);
  // Horizontal pass: each source row becomes `width` values.
  const tmp = new Float64Array(width * srcH);
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (const { index, weight } of cols[x]) {
        sum += weight * img.data[y * srcW + index];
      }
      tmp[y * width + x] = sum;
    }
  }
  // Vertical pass: combine the intermediate rows into each output row.
  const acc = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    acc.fill(0);
    for (const { index, weight } of rows[y]) {
      for (let x = 0; x < width; x++) acc[x] += weight * tmp[index * width + x];
    }
    for (let x = 0; x < width; x++) out.data[y * width + x] = acc[x];
  }
  return out;
}
