import { applySimilarity, type Similarity } from "./transform";

/** The same spot in two photos, in each photo's normalised coordinates. */
export type PointPair = { a: [number, number]; b: [number, number] };

/** Least-squares similarity carrying each pair's `a` onto its `b`. */
export function fitSimilarity(pairs: PointPair[]): Similarity | null {
  const n = pairs.length;
  if (n < 2) return null;
  let ax = 0;
  let ay = 0;
  let bx = 0;
  let by = 0;
  for (const { a, b } of pairs) {
    ax += a[0] / n;
    ay += a[1] / n;
    bx += b[0] / n;
    by += b[1] / n;
  }
  let dot = 0;
  let cross = 0;
  let spread = 0;
  for (const { a, b } of pairs) {
    const [u, v] = [a[0] - ax, a[1] - ay];
    const [p, q] = [b[0] - bx, b[1] - by];
    dot += u * p + v * q;
    cross += u * q - v * p;
    spread += u * u + v * v;
  }
  if (spread < 1e-9) return null;
  const c = dot / spread;
  const s = cross / spread;
  if (Math.hypot(c, s) < 1e-6) return null;
  return {
    scale: Math.hypot(c, s),
    rotation: Math.atan2(s, c),
    tx: bx - (c * ax - s * ay),
    ty: by - (s * ax + c * ay),
  };
}

function miss(t: Similarity, { a, b }: PointPair) {
  const [x, y] = applySimilarity(t, a[0], a[1]);
  return Math.hypot(x - b[0], y - b[1]);
}

/**
 * Fit from the largest set of pairs that agree to within `tolerance`, so a
 * few misplaced points don't drag the result. Every two pairs propose a
 * transform; the one most pairs agree with is refitted on those pairs.
 */
export function robustSimilarity(
  pairs: PointPair[],
  tolerance: number,
): { transform: Similarity; inliers: number; rms: number } | null {
  let best: PointPair[] = [];
  for (let i = 0; i < pairs.length; i++)
    for (let j = i + 1; j < pairs.length; j++) {
      const t = fitSimilarity([pairs[i], pairs[j]]);
      if (!t) continue;
      const agree = pairs.filter((p) => miss(t, p) < tolerance);
      if (agree.length > best.length) best = agree;
    }
  const transform = fitSimilarity(best);
  if (!transform) return null;
  const rms = Math.sqrt(
    best.reduce((sum, p) => sum + miss(transform, p) ** 2, 0) / best.length,
  );
  return { transform, inliers: best.length, rms };
}
