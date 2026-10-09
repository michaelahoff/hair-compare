/**
 * Region outlines as polygons in image fractions (0 to 1, from the top left),
 * and the maths to draw, resample and morph them.
 *
 * Pure functions with no React or Expo imports, so they run under `bun test`.
 * Functions marked "worklet" are also called from Reanimated animated props,
 * so they must not call anything outside themselves.
 */
import {
  applySimilarity,
  invertSimilarity,
  type Similarity,
} from "./alignment/transform";
import { baseBox } from "./framing";

export type Point = { x: number; y: number };

/** The parts of an analysis region that outlines need. */
export type RegionShape = {
  area: string;
  box: { x: number; y: number; width: number; height: number } | null;
  outline?: Point[] | null;
};

/** Points per outline after resampling, so two outlines can morph. */
export const OUTLINE_POINTS = 24;

/**
 * The region's outline when the model gave one with at least three points,
 * else its box as four corners clockwise from the top left, else null.
 */
export function regionPolygon(region: RegionShape): Point[] | null {
  if (region.outline && region.outline.length >= 3) return region.outline;
  const box = region.box;
  if (!box) return null;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  return [
    { x: box.x, y: box.y },
    { x: right, y: box.y },
    { x: right, y: bottom },
    { x: box.x, y: bottom },
  ];
}

/** A copy of the ring, clockwise on screen (y down). */
export function orientClockwise(points: Point[]): Point[] {
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return twiceArea < 0 ? points.slice().reverse() : points.slice();
}

/**
 * Area centroid of a polygon, or the mean of its points when it has no area
 * (collinear or repeated points). `points` must not be empty.
 */
export function centroid(points: Point[]): Point {
  "worklet";
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    let meanX = 0;
    let meanY = 0;
    for (let i = 0; i < points.length; i++) {
      meanX += points[i].x;
      meanY += points[i].y;
    }
    return { x: meanX / points.length, y: meanY / points.length };
  }
  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

/**
 * `count` points evenly spaced by perimeter distance around the closed ring,
 * clockwise. The first point is where the ring crosses the vertical line
 * through the centroid, highest point first, so outlines of similar shapes
 * start in comparable places and their samples pair up for morphing.
 */
export function resample(points: Point[], count = OUTLINE_POINTS): Point[] {
  const ring = orientClockwise(points);
  const n = ring.length;
  if (n === 0) return [];
  // offsets[i] is the perimeter distance to ring[i]; offsets[n] is the whole.
  const offsets = [0];
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    offsets.push(offsets[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const perimeter = offsets[n];
  if (perimeter === 0)
    return Array.from({ length: count }, () => ({ ...ring[0] }));
  const start = topOffset(ring, offsets, centroid(ring).x);
  const samples: Point[] = [];
  for (let k = 0; k < count; k++) {
    const distance = (start + (k * perimeter) / count) % perimeter;
    samples.push(pointAt(ring, offsets, distance));
  }
  return samples;
}

/**
 * Perimeter distance to the highest point where the ring crosses the vertical
 * line at `x`, or 0 when it never does.
 */
function topOffset(ring: Point[], offsets: number[], x: number): number {
  const n = ring.length;
  let bestY = Infinity;
  let best = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    if (x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x)) continue;
    // A vertical edge lying on the line offers both of its ends.
    const ts = a.x === b.x ? [0, 1] : [(x - a.x) / (b.x - a.x)];
    for (const t of ts) {
      const y = a.y + (b.y - a.y) * t;
      if (y < bestY) {
        bestY = y;
        best = offsets[i] + (offsets[i + 1] - offsets[i]) * t;
      }
    }
  }
  return best;
}

/** The point `distance` along the perimeter, for 0 <= distance < perimeter. */
function pointAt(ring: Point[], offsets: number[], distance: number): Point {
  const n = ring.length;
  let i = 0;
  while (i < n - 1 && offsets[i + 1] < distance) i++;
  const a = ring[i];
  const b = ring[(i + 1) % n];
  const length = offsets[i + 1] - offsets[i];
  const t = length > 0 ? (distance - offsets[i]) / length : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * SVG path for a closed polygon in image fractions, drawn at `width` by
 * `height` pixels. Coordinates are rounded to a tenth of a pixel.
 */
export function toPath(points: Point[], width: number, height: number): string {
  "worklet";
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = Math.round(p.x * width * 10) / 10;
    const y = Math.round(p.y * height * 10) / 10;
    d += `${i === 0 ? "M" : "L"}${x} ${y}`;
  }
  return `${d}Z`;
}

/** Point by point, a fraction `t` of the way from `a` to `b`. Same length. */
export function lerpPoints(a: Point[], b: Point[], t: number): Point[] {
  "worklet";
  const out: Point[] = [];
  for (let i = 0; i < a.length; i++) {
    out.push({
      x: a[i].x + (b[i].x - a[i].x) * t,
      y: a[i].y + (b[i].y - a[i].y) * t,
    });
  }
  return out;
}

/**
 * Map fractions of one photo onto another, both drawn on their view's guide.
 * Each photo's framing places it on the guide, so a point is carried through
 * `from`'s framing and back out through `to`'s inverse framing.
 */
export function mapBetweenPhotos(
  points: Point[],
  from: { width: number; height: number },
  fromFraming: Similarity,
  to: { width: number; height: number },
  toFraming: Similarity,
): Point[] {
  const fromBox = baseBox(from);
  const toBox = baseBox(to);
  const toInverse = invertSimilarity(toFraming);
  return points.map((p) => {
    const guide = applySimilarity(
      fromFraming,
      (p.x - 0.5) * fromBox.width,
      (p.y - 0.5) * fromBox.height,
    );
    const [u, v] = applySimilarity(toInverse, guide[0], guide[1]);
    return { x: u / toBox.width + 0.5, y: v / toBox.height + 0.5 };
  });
}

/**
 * Photo fractions to guide units: centred on the guide square, side 1,
 * before the view's turn. A region in guide units sits on the same spot of
 * every photo of the view that is lined up.
 */
export function photoToGuide(
  points: Point[],
  photo: { width: number; height: number },
  framing: Similarity,
): Point[] {
  const box = baseBox(photo);
  return points.map((p) => {
    const [x, y] = applySimilarity(
      framing,
      (p.x - 0.5) * box.width,
      (p.y - 0.5) * box.height,
    );
    return { x, y };
  });
}

/** Guide units back to photo fractions: the inverse of `photoToGuide`. */
export function guideToPhoto(
  points: Point[],
  photo: { width: number; height: number },
  framing: Similarity,
): Point[] {
  const box = baseBox(photo);
  const inverse = invertSimilarity(framing);
  return points.map((p) => {
    const [x, y] = applySimilarity(inverse, p.x, p.y);
    return { x: x / box.width + 0.5, y: y / box.height + 0.5 };
  });
}
