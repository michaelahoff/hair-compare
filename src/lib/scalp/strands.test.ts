import { describe, expect, test } from "bun:test";

import { rng } from "../alignment/test-images";
import { createMask, type Mask } from "./image-ops";
import { createRgb, type RgbImage } from "./rgb";
import { analyseStrands, strandSummary } from "./strands";

const N = 300;
const PX_PER_CM = 30;
const CENTRE = { x: 150, y: 150 };
const CROWN_CM = 2.5;
const OUTSIDE_PER_CM2 = 60;
const INSIDE_PER_CM2 = 15;
const SEED = 7;

const full = (): Mask => {
  const mask = createMask(N, N);
  mask.data.fill(1);
  return mask;
};

/** Plain pink skin, with no hair. */
function pinkScalp(): RgbImage {
  const img = createRgb(N, N);
  for (let i = 0; i < N * N; i++) {
    img.data[i * 3] = 215;
    img.data[i * 3 + 1] = 170;
    img.data[i * 3 + 2] = 160;
  }
  return img;
}

/** Draws a 1-px dark stroke of the given length and angle, centred on (cx, cy). */
function stroke(
  img: RgbImage,
  cx: number,
  cy: number,
  length: number,
  angle: number,
): void {
  for (let t = -length / 2; t <= length / 2; t += 0.5) {
    const x = Math.round(cx + Math.cos(angle) * t);
    const y = Math.round(cy + Math.sin(angle) * t);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
    const j = (y * img.width + x) * 3;
    img.data[j] = 40;
    img.data[j + 1] = 40;
    img.data[j + 2] = 40;
  }
}

/**
 * Pink skin with random 8-15 px strokes: about 60 per cm² outside the crown
 * disc and 15 per cm² inside it. Stroke centres are drawn until each zone has
 * its count, so the scene depends only on the seed.
 */
function drawnScalp(seed: number): RgbImage {
  const img = pinkScalp();
  const rand = rng(seed);
  const discCm2 = Math.PI * CROWN_CM * CROWN_CM;
  const totalCm2 = (N * N) / (PX_PER_CM * PX_PER_CM);
  const zones = [
    {
      count: Math.round(OUTSIDE_PER_CM2 * (totalCm2 - discCm2)),
      inside: false,
    },
    { count: Math.round(INSIDE_PER_CM2 * discCm2), inside: true },
  ];
  for (const { count, inside } of zones) {
    for (let k = 0; k < count; ) {
      const cx = rand() * N;
      const cy = rand() * N;
      const d = Math.hypot(cx - CENTRE.x, cy - CENTRE.y) / PX_PER_CM;
      if ((d < CROWN_CM) !== inside) continue;
      stroke(img, cx, cy, 8 + rand() * 7, rand() * Math.PI);
      k++;
    }
  }
  return img;
}

describe("analyseStrands on a scalp with drawn strands", () => {
  const a = analyseStrands(drawnScalp(SEED), full(), PX_PER_CM, CENTRE);

  test("the crown is sparser than the ring", () => {
    expect(a.crown.density).toBeLessThan(a.ring.density);
  });

  test("the crown-to-ring ratio is between 0.1 and 0.6", () => {
    expect(a.crownToRing).not.toBeNull();
    expect(a.crownToRing ?? Number.NaN).toBeGreaterThan(0.1);
    expect(a.crownToRing ?? Number.NaN).toBeLessThan(0.6);
  });

  test("the whole head has hair", () => {
    expect(a.whole.density).toBeGreaterThan(0);
  });

  test("the transect cross-check is within a factor of 2 of the whole density", () => {
    expect(a.transect).toBeGreaterThan(a.whole.density / 2);
    expect(a.transect).toBeLessThan(a.whole.density * 2);
  });

  test("the typical unbroken length is between 1.5 and 6 mm", () => {
    expect(a.typicalLengthMm).not.toBeNull();
    expect(a.typicalLengthMm ?? Number.NaN).toBeGreaterThan(1.5);
    expect(a.typicalLengthMm ?? Number.NaN).toBeLessThan(6);
  });

  test("no hair line lies outside the region", () => {
    const outside = a.lines.filter((v, i) => v === 1 && a.region[i] === 0);
    expect(outside.length).toBe(0);
  });
});

describe("analyseStrands on a scalp with no hair", () => {
  // With no lines the ring's density is 0, and 0 / 0 is undefined. So the
  // crown-to-ring ratio is null, not 0, and the UI can say it was not measured.
  const a = analyseStrands(pinkScalp(), full(), PX_PER_CM, CENTRE);

  test("every density and the transect are 0, with no typical length", () => {
    expect(a.lines.some((v) => v !== 0)).toBe(false);
    expect(a.crown.density).toBe(0);
    expect(a.ring.density).toBe(0);
    expect(a.whole.density).toBe(0);
    expect(a.transect).toBe(0);
    expect(a.typicalLengthMm).toBeNull();
  });

  test("the crown-to-ring ratio is null", () => {
    expect(a.crownToRing).toBeNull();
  });

  test("the threshold falls to its floor of 0.1", () => {
    expect(a.threshold).toBe(0.1);
  });
});

describe("strandSummary", () => {
  const a = analyseStrands(drawnScalp(SEED), full(), PX_PER_CM, CENTRE);

  test("states the ratio and both densities to one decimal place", () => {
    expect(strandSummary(a)).toMatch(
      /^Crown shows \d+\.\d× the hair-line density of the surrounding ring \(\d+\.\d vs \d+\.\d cm of hair per cm²\)\.$/,
    );
  });

  test("says the ring could not be measured when it is too small", () => {
    const small = { ...a, crownToRing: null, ring: { ...a.ring, areaCm2: 1 } };
    expect(strandSummary(small)).toBe(
      "The surrounding ring could not be measured, so the crown cannot be compared with it.",
    );
  });

  test("says no hair was found in the ring when its density is 0", () => {
    const bare = { ...a, crownToRing: null, ring: { ...a.ring, density: 0 } };
    expect(strandSummary(bare)).toBe(
      "No hair lines were found in the surrounding ring, so the crown cannot be compared with it.",
    );
  });
});
