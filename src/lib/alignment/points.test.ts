import { describe, expect, test } from "bun:test";

import { fitSimilarity, robustSimilarity, type PointPair } from "./points";
import { applySimilarity, type Similarity } from "./transform";

const truth: Similarity = {
  tx: 0.04,
  ty: -0.06,
  rotation: (150 * Math.PI) / 180,
  scale: 0.85,
};
const spots: [number, number][] = [
  [-0.3, -0.4],
  [0.2, -0.35],
  [0.05, 0.1],
  [-0.25, 0.3],
  [0.3, 0.45],
  [0.1, -0.05],
];
const pairs: PointPair[] = spots.map((a) => ({
  a,
  b: applySimilarity(truth, a[0], a[1]),
}));

function expectClose(actual: Similarity | null, expected: Similarity) {
  expect(actual).not.toBeNull();
  expect(actual!.tx).toBeCloseTo(expected.tx, 6);
  expect(actual!.ty).toBeCloseTo(expected.ty, 6);
  expect(actual!.rotation).toBeCloseTo(expected.rotation, 6);
  expect(actual!.scale).toBeCloseTo(expected.scale, 6);
}

describe("fitSimilarity", () => {
  test("recovers an exact transform, even turned past 90°", () => {
    expectClose(fitSimilarity(pairs), truth);
  });

  test("needs two distinct points", () => {
    expect(fitSimilarity(pairs.slice(0, 1))).toBeNull();
    expect(fitSimilarity([pairs[0], pairs[0]])).toBeNull();
  });
});

describe("robustSimilarity", () => {
  test("ignores misplaced points", () => {
    const wrong: PointPair[] = [
      { a: [0.2, 0.2], b: [-0.4, 0.4] },
      { a: [-0.1, 0.4], b: [0.45, -0.3] },
    ];
    const fit = robustSimilarity([...pairs, ...wrong], 0.05);
    expect(fit?.inliers).toBe(pairs.length);
    expect(fit?.rms).toBeLessThan(1e-9);
    expectClose(fit!.transform, truth);
  });

  test("reports how far agreeing points still miss", () => {
    const nudged = pairs.map(({ a, b }, i) => ({
      a,
      b: [b[0] + (i % 2 ? 0.01 : -0.01), b[1]] as [number, number],
    }));
    const fit = robustSimilarity(nudged, 0.05);
    expect(fit?.inliers).toBe(pairs.length);
    expect(fit!.rms).toBeGreaterThan(0.005);
    expect(fit!.rms).toBeLessThan(0.015);
  });

  test("no points, no fit", () => {
    expect(robustSimilarity([], 0.05)).toBeNull();
  });
});
