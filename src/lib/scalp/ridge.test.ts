import { describe, expect, test } from "bun:test";

import { createImage, type GrayImage } from "../alignment/image";
import {
  hessianRidge,
  lineDensity,
  multiRidge,
  nonMaxSuppress,
  removeShort,
  splitAtJunctions,
  thinLines,
  transectDensity,
} from "./ridge";

type Point = [number, number];
type Segment = [Point, Point];

const N = 96;
const SIGMA = 1.5;

/** Pixels sampled along a segment from a to b, rounded to the grid. */
function segment([a, b]: Segment): Point[] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const out: Point[] = [];
  for (let t = 0; t <= length; t += 0.5) {
    out.push([
      Math.round(a[0] + ((b[0] - a[0]) * t) / length),
      Math.round(a[1] + ((b[1] - a[1]) * t) / length),
    ]);
  }
  return out;
}

/** Pixels of a segment at least 6 px from both ends, so end effects are left out. */
function core(line: Segment): Point[] {
  const [a, b] = line;
  return segment(line).filter(
    ([x, y]) =>
      Math.hypot(x - a[0], y - a[1]) > 6 && Math.hypot(x - b[0], y - b[1]) > 6,
  );
}

function paint(img: GrayImage, line: Segment, value: number): void {
  for (const [x, y] of segment(line)) img.data[y * img.width + x] = value;
}

function maxAt(img: GrayImage, points: Point[]): number {
  let max = -Infinity;
  for (const [x, y] of points) max = Math.max(max, img.data[y * img.width + x]);
  return max;
}

const DARK_H: Segment = [
  [8, 20],
  [40, 20],
];
const DARK_V: Segment = [
  [60, 8],
  [60, 40],
];
const DARK_D: Segment = [
  [8, 52],
  [36, 80],
];
const BRIGHT_H: Segment = [
  [56, 70],
  [88, 70],
];

/** Flat 0.6 background, three 1 px dark lines and one 1 px bright line. */
function scene(): GrayImage {
  const img = createImage(N, N);
  img.data.fill(0.6);
  paint(img, DARK_H, 0.2);
  paint(img, DARK_V, 0.2);
  paint(img, DARK_D, 0.2);
  paint(img, BRIGHT_H, 0.95);
  return img;
}

describe("hessianRidge", () => {
  test("dark lines respond on dark=true and the bright line does not", () => {
    const { response } = hessianRidge(scene(), SIGMA, true);
    for (const line of [DARK_H, DARK_V, DARK_D]) {
      expect(maxAt(response, core(line))).toBeGreaterThan(0.04);
    }
    expect(maxAt(response, core(BRIGHT_H))).toBeLessThan(0.01);
  });

  test("bright lines respond on dark=false and the dark lines do not", () => {
    const { response } = hessianRidge(scene(), SIGMA, false);
    for (const line of [DARK_H, DARK_V, DARK_D]) {
      expect(maxAt(response, core(line))).toBeLessThan(0.01);
    }
    expect(maxAt(response, core(BRIGHT_H))).toBeGreaterThan(0.04);
  });

  test("theta points across the line", () => {
    const { theta } = hessianRidge(scene(), SIGMA, true);
    const at = ([x, y]: Point) => theta.data[y * N + x];
    // Horizontal line: across it is vertical.
    expect(Math.abs(Math.abs(at([24, 20])) - Math.PI / 2)).toBeLessThan(0.05);
    // Vertical line: across it is horizontal.
    expect(Math.abs(at([60, 24]))).toBeLessThan(0.05);
    // Down-right diagonal: across it is (1, -1).
    expect(Math.abs(at([22, 66]) + Math.PI / 4)).toBeLessThan(0.05);
  });

  test("the inside of a filled dark 9x9 square is quiet next to a line", () => {
    // Only the interior is checked. A square's straight edges look like lines
    // to a second-derivative filter, so they are not asserted here.
    const sigma = 1;
    const square = createImage(N, N);
    square.data.fill(0.6);
    for (let y = 40; y < 49; y++) {
      for (let x = 40; x < 49; x++) square.data[y * N + x] = 0.2;
    }
    const line = createImage(N, N);
    line.data.fill(0.6);
    paint(line, [
      [20, 44],
      [76, 44],
    ], 0.2);

    const lineMax = maxAt(
      hessianRidge(line, sigma, true).response,
      segment([
        [30, 44],
        [60, 44],
      ]),
    );
    const inside: Point[] = [];
    for (let y = 43; y <= 45; y++) {
      for (let x = 43; x <= 45; x++) inside.push([x, y]);
    }
    const squareMax = maxAt(
      hessianRidge(square, sigma, true).response,
      inside,
    );
    expect(squareMax).toBeLessThan(0.1 * lineMax);
  });
});

describe("multiRidge", () => {
  test("keeps the strongest scale at each pixel", () => {
    const img = scene();
    const fine = hessianRidge(img, 1, true).response;
    const coarse = hessianRidge(img, 2.5, true).response;
    const { response } = multiRidge(img, [1, 2.5], true);
    let worst = 0;
    for (let i = 0; i < response.data.length; i++) {
      const expected = Math.max(fine.data[i], coarse.data[i]);
      worst = Math.max(worst, Math.abs(response.data[i] - expected));
    }
    expect(worst).toBeLessThan(1e-6);
  });
});

describe("nonMaxSuppress", () => {
  test("a 3 px dark bar thins to one ridge pixel per column", () => {
    const img = createImage(N, N);
    img.data.fill(0.6);
    for (let y = 40; y <= 42; y++) {
      for (let x = 10; x <= 85; x++) img.data[y * N + x] = 0.2;
    }
    const { response, theta } = hessianRidge(img, SIGMA, true);
    const ridge = nonMaxSuppress(response, theta);
    for (let x = 20; x <= 75; x++) {
      const column: number[] = [];
      for (let y = 30; y <= 50; y++) if (ridge[y * N + x]) column.push(y);
      expect(column).toEqual([41]);
    }
  });
});

describe("thinLines", () => {
  test("keeps strong ridge centres that are inside the mask", () => {
    const { response, theta } = hessianRidge(scene(), SIGMA, true);
    const mask = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < 50; x++) mask[y * N + x] = 1;
    }
    const lines = thinLines(response, theta, 0.04, mask);
    expect(lines[20 * N + 24]).toBe(1);
    expect(lines[24 * N + 60]).toBe(0);
    for (let y = 0; y < N; y++) {
      for (let x = 50; x < N; x++) expect(lines[y * N + x]).toBe(0);
    }
  });

  test("nothing passes a threshold above every response", () => {
    const { response, theta } = hessianRidge(scene(), SIGMA, true);
    expect(thinLines(response, theta, 1).some((v) => v !== 0)).toBe(false);
  });
});

describe("splitAtJunctions", () => {
  test("a plus sign of two crossing lines splits into four pieces", () => {
    const S = 41;
    const c = 20;
    const mask = new Uint8Array(S * S);
    for (let x = 2; x <= 38; x++) mask[c * S + x] = 1;
    for (let y = 2; y <= 38; y++) mask[y * S + c] = 1;
    const { pieces, lengths } = splitAtJunctions(mask, S, S);
    expect(lengths).toEqual([16, 16, 16, 16]);
    expect(pieces[c * S + c]).toBe(0);
  });
});

describe("removeShort", () => {
  test("drops a 3-pixel speck and keeps a 20-pixel line", () => {
    const S = 40;
    const mask = new Uint8Array(S * S);
    for (const x of [5, 6, 7]) mask[5 * S + x] = 1;
    for (let x = 10; x < 30; x++) mask[25 * S + x] = 1;
    // Diagonal line: only 8-connected, so it survives only if diagonals join.
    for (let k = 0; k < 20; k++) mask[(2 + k) * S + (20 + k)] = 1;
    const out = removeShort(mask, S, S, 10);
    expect(out[5 * S + 6]).toBe(0);
    for (let x = 10; x < 30; x++) expect(out[25 * S + x]).toBe(1);
    for (let k = 0; k < 20; k++) expect(out[(2 + k) * S + (20 + k)]).toBe(1);
    expect(out.reduce((sum, v) => sum + v, 0)).toBe(40);
  });
});

describe("lineDensity", () => {
  const size = 100;
  const region = new Uint8Array(size * size).fill(1);

  test("10 lines of 50 px in a 100x100 region at 10 px/cm", () => {
    const lines = new Uint8Array(size * size);
    for (let k = 0; k < 10; k++) {
      for (let x = 10; x < 60; x++) lines[(5 + 10 * k) * size + x] = 1;
    }
    const { lengthCm, areaCm2, density } = lineDensity(
      lines,
      region,
      size,
      size,
      10,
    );
    expect(lengthCm).toBeCloseTo(50, 6);
    expect(areaCm2).toBeCloseTo(100, 6);
    expect(density).toBeCloseTo(0.5, 6);
  });

  test("density is NaN below 0.25 cm²", () => {
    const lines = new Uint8Array(size * size);
    const small = new Uint8Array(size * size);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) small[y * size + x] = 1;
    }
    const { areaCm2, density } = lineDensity(lines, small, size, size, 10);
    expect(areaCm2).toBeCloseTo(0.16, 6);
    expect(density).toBeNaN();
  });
});

describe("transectDensity", () => {
  test("matches the true length of isotropic lines within 10%", () => {
    // Eight evenly spread directions, each a family of parallel lines 100 px
    // apart, on a 200x200 field at 10 px/cm. Samples outside the field are
    // dropped, so trueLength is the length that lies inside it.
    const W = 200;
    const PX = 10;
    const lines = new Uint8Array(W * W);
    let trueLength = 0;
    for (let k = 0; k < 8; k++) {
      const angle = ((k + 0.5) * Math.PI) / 8;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      for (let s = -200; s <= 200; s += 100) {
        for (let t = -400; t <= 400; t += 0.5) {
          const x = Math.round(100 - dy * s + dx * t);
          const y = Math.round(100 + dx * s + dy * t);
          if (x < 0 || y < 0 || x >= W || y >= W) continue;
          lines[y * W + x] = 1;
          trueLength += 0.5;
        }
      }
    }
    const region = new Uint8Array(W * W).fill(1);
    const expected = trueLength / PX / ((W * W) / (PX * PX));
    const estimate = transectDensity(lines, region, W, W, PX, 2);
    expect(Math.abs(estimate / expected - 1)).toBeLessThan(0.1);
  });
});
