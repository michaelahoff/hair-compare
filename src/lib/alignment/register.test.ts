import { describe, expect, test } from "bun:test";

import { createImage, warpImage } from "./image";
import { relight, syntheticScalp } from "./test-images";
import { align } from "./register";
import {
  applySimilarity,
  displayTransform,
  invertSimilarity,
  type Similarity,
} from "./transform";

function expectClose(actual: Similarity, expected: Similarity) {
  expect(Math.abs(actual.tx - expected.tx)).toBeLessThan(0.012);
  expect(Math.abs(actual.ty - expected.ty)).toBeLessThan(0.012);
  expect(Math.abs(actual.rotation - expected.rotation)).toBeLessThan(
    (1.5 * Math.PI) / 180,
  );
  expect(Math.abs(Math.log(actual.scale / expected.scale))).toBeLessThan(0.02);
}

describe("transform", () => {
  test("inverse round-trips a point", () => {
    const t: Similarity = { tx: 0.1, ty: -0.05, rotation: 0.4, scale: 1.3 };
    const [qu, qv] = applySimilarity(t, 0.2, 0.15);
    const [pu, pv] = applySimilarity(invertSimilarity(t), qu, qv);
    expect(pu).toBeCloseTo(0.2, 10);
    expect(pv).toBeCloseTo(0.15, 10);
  });

  test("displayTransform of identity is a no-op", () => {
    expect(
      displayTransform({ tx: 0, ty: 0, rotation: 0, scale: 1 }, 300),
    ).toEqual([
      { translateX: -0 },
      { translateY: -0 },
      { rotate: "0deg" },
      { scale: 1 },
    ]);
  });
});

describe("align", () => {
  const ref = syntheticScalp(128, 160);

  const cases: [string, Similarity][] = [
    ["shift only", { tx: 0.06, ty: -0.04, rotation: 0, scale: 1 }],
    [
      "closer and tilted",
      { tx: -0.03, ty: 0.05, rotation: (12 * Math.PI) / 180, scale: 1.18 },
    ],
    [
      "further away",
      { tx: 0.02, ty: 0.02, rotation: (-7 * Math.PI) / 180, scale: 0.82 },
    ],
    [
      "phone held upside down",
      { tx: 0.01, ty: -0.03, rotation: (165 * Math.PI) / 180, scale: 1.05 },
    ],
  ];

  for (const [name, truth] of cases) {
    test(`recovers ${name} under different lighting`, () => {
      const target = relight(
        warpImage(ref, truth, 128, 170, 0.2),
        0.75,
        0.12,
        0.05,
        7,
      );
      const started = performance.now();
      const result = align(ref, target);
      const elapsed = performance.now() - started;
      expectClose(result.transform, truth);
      expect(result.score).toBeGreaterThan(0.5);
      expect(elapsed).toBeLessThan(2000);
    });
  }

  test("restricted rotation range still finds a small tilt", () => {
    const truth: Similarity = {
      tx: 0.03,
      ty: 0,
      rotation: (8 * Math.PI) / 180,
      scale: 1.1,
    };
    const target = warpImage(ref, truth, 128, 160, 0.2);
    expectClose(align(ref, target, { maxRotationDeg: 30 }).transform, truth);
  });

  test("an image with no shared structure scores low", () => {
    const noise = relight(createImage(128, 160), 1, 0.5, 0.5, 3);
    expect(align(ref, noise).score).toBeLessThan(0.3);
  });
  test("featureless photos return a rejected match instead of crashing", () => {
    const result = align(createImage(96, 120), createImage(96, 120));
    expect(result.score).toBe(0);
    expect(result.transform.scale).toBe(1);
  });
});
