import { describe, expect, test } from "bun:test";

import { rng } from "../alignment/test-images";
import {
  comparable,
  computeScalpMetrics,
  computeScalpMetricsAsync,
  linesReliable,
  metricsSentence,
  type ScalpMetrics,
} from "./metrics";
import { createRgb, type RgbImage } from "./rgb";

const W = 256;
const H = 200;
const HAIR = { x: 128, y: 100, r: 70 };
const PATCH = { x: 110, y: 88, r: 25 };

type Disc = { x: number; y: number; r: number };
const inDisc = (d: Disc, x: number, y: number) =>
  (x - d.x) ** 2 + (y - d.y) ** 2 <= d.r ** 2;

/** A dark, noisy hair disc with a smooth pink patch inside it, on beige. */
function syntheticHead(): RgbImage {
  const img = createRgb(W, H);
  const rand = rng(7);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let px = [200, 180, 150];
      if (inDisc(HAIR, x, y)) {
        const grey = Math.round(30 + rand() * 60);
        px = [grey, grey, grey];
      }
      if (inDisc(PATCH, x, y)) px = [220, 170, 165];
      img.data.set(px, (y * W + x) * 3);
    }
  }
  return img;
}

/** Plain beige, as a photo of the floor would be. */
function floor(): RgbImage {
  const img = createRgb(W, H);
  for (let i = 0; i < W * H; i++) img.data.set([200, 180, 150], i * 3);
  return img;
}

/** Smooth pink with a little sensor noise: a clean-shaven head, or just skin. */
function bareSkin(): RgbImage {
  const img = createRgb(W, H);
  const rand = rng(3);
  for (let i = 0; i < W * H; i++) {
    const n = Math.round(rand() * 4 - 2);
    img.data.set([220 + n, 170 + n, 165 + n], i * 3);
  }
  return img;
}

describe("computeScalpMetrics", () => {
  const { metrics } = computeScalpMetrics(syntheticHead(), "buzzed");

  test("reads a head that is fully in frame", () => {
    expect(metrics.scaleKnown).toBe(true);
    expect(metrics.exposure).toBeGreaterThan(0.05);
    expect(metrics.exposure).toBeLessThan(0.5);
    expect(metrics.patchCm2).toBeGreaterThan(0);
    expect(metrics.headAreaCm2).toBeGreaterThan(50);
    // The patch centre is near the pink disc, as photo fractions.
    expect(metrics.patchCentre.x).toBeCloseTo(PATCH.x / W, 1);
    expect(metrics.patchCentre.y).toBeCloseTo(PATCH.y / H, 1);
    expect(metrics.linesReliable).toBe(true);
    expect(Number.isFinite(metrics.whole.lengthCm)).toBe(true);
  });

  test("throws when the photo holds no head", () => {
    expect(() => computeScalpMetrics(floor(), "short")).toThrow("No head was found");
    expect(() => computeScalpMetrics(bareSkin(), "short")).toThrow("No head was found");
  });

  test("marks lines unreliable on medium and long hair", () => {
    for (const length of ["medium", "long", null] as const) {
      expect(computeScalpMetrics(syntheticHead(), length).metrics.linesReliable).toBe(false);
      expect(linesReliable(length)).toBe(false);
    }
    expect(linesReliable("short")).toBe(true);
  });

  test("async run pauses between stages and gives the same figures", async () => {
    let pauses = 0;
    const { metrics: paused } = await computeScalpMetricsAsync(syntheticHead(), "buzzed", async () => {
      pauses++;
    });
    expect(pauses).toBeGreaterThanOrEqual(6);
    expect(paused).toEqual(metrics);
  });

  test("survives a JSON round trip (no NaN anywhere)", () => {
    const text = JSON.stringify(metrics);
    expect(text).not.toContain("NaN");
    expect(JSON.parse(text)).toEqual(metrics);
  });
});

describe("comparable and metricsSentence", () => {
  const base: ScalpMetrics = {
    version: 2,
    hairLength: "short",
    width: 900,
    scaleKnown: true,
    pxPerCm: 60,
    headAreaCm2: 170,
    exposure: 0.2,
    patchCm2: 25,
    patchCentre: { x: 0.5, y: 0.5 },
    crown: { lengthCm: 80, areaCm2: 19.6, density: 4.1 },
    ring: { lengthCm: 470, areaCm2: 56.5, density: 8.3 },
    whole: { lengthCm: 1200, areaCm2: 170, density: 7.1 },
    crownToRing: 0.5,
    transect: 7,
    typicalLengthMm: 3,
    linesReliable: true,
  };

  test("photos of different hair length or cut-off heads don't compare", () => {
    expect(comparable(base, base).ok).toBe(true);
    expect(comparable(base, { ...base, hairLength: "long", linesReliable: false }).ok).toBe(false);
    expect(comparable(base, { ...base, scaleKnown: false }).reason).toContain("cut off");
  });

  test("the sentence never claims a ratio it doesn't have", () => {
    expect(metricsSentence(base)).toContain("0.50×");
    expect(metricsSentence({ ...base, crownToRing: null })).toContain("couldn't be measured");
    expect(
      metricsSentence({ ...base, ring: { ...base.ring, density: null } }),
    ).toContain("couldn't be measured");
    expect(metricsSentence({ ...base, linesReliable: false })).toContain("longer hair");
  });
});
