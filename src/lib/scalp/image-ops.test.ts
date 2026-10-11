import { describe, expect, test } from "bun:test";

import { createImage, type GrayImage } from "../alignment/image";
import {
  close,
  connectedComponents,
  createMask,
  dilate,
  distanceTransform,
  erode,
  fillHoles,
  gaussianBlur,
  largestComponent,
  localStd,
  maskFrom,
  open,
  resizeArea,
  type Mask,
} from "./image-ops";

/** Mask from rows of "#" (inside) and "." (outside). */
function maskOf(rows: string[]): Mask {
  const m = createMask(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      m.data[y * m.width + x] = row[x] === "#" ? 1 : 0;
    }
  });
  return m;
}

/** Inverse of maskOf. */
function rowsOf(m: Mask): string[] {
  const rows: string[] = [];
  for (let y = 0; y < m.height; y++) {
    let row = "";
    for (let x = 0; x < m.width; x++) {
      row += m.data[y * m.width + x] ? "#" : ".";
    }
    rows.push(row);
  }
  return rows;
}

/** Gray image from rows of values. */
function imageOf(rows: number[][]): GrayImage {
  const img = createImage(rows[0].length, rows.length);
  rows.forEach((row, y) =>
    row.forEach((v, x) => {
      img.data[y * img.width + x] = v;
    }),
  );
  return img;
}

/** Normalised sigma-1 Gaussian weight at offset d (radius 3). */
function gauss1(d: number): number {
  const z = 1 + 2 * (Math.exp(-0.5) + Math.exp(-2) + Math.exp(-4.5));
  return Math.exp(-(d * d) / 2) / z;
}

/** Single inside pixel in the middle of a 7x7 mask, as a disc of radius 2. */
const centrePixel = (): Mask => {
  const m = createMask(7, 7);
  m.data[3 * 7 + 3] = 1;
  return m;
};

describe("gaussianBlur", () => {
  test("a sigma of zero or less returns an equal copy", () => {
    const img = imageOf([
      [0.1, 0.9],
      [0.4, 0.6],
    ]);
    const out = gaussianBlur(img, 0);
    expect(Array.from(out.data)).toEqual(Array.from(img.data));
    expect(out.data).not.toBe(img.data);
  });

  test("an impulse becomes a normalised, symmetric kernel", () => {
    const img = createImage(9, 9);
    img.data[4 * 9 + 4] = 1;
    const out = gaussianBlur(img, 1);
    const at = (x: number, y: number) => out.data[y * 9 + x];
    let sum = 0;
    for (const v of out.data) sum += v;
    expect(sum).toBeCloseTo(1, 5);
    expect(at(4, 4)).toBeCloseTo(gauss1(0) * gauss1(0), 6);
    expect(at(5, 4)).toBeCloseTo(gauss1(1) * gauss1(0), 6);
    expect(at(7, 7)).toBeCloseTo(gauss1(3) * gauss1(3), 6);
    expect(at(4, 5)).toBeCloseTo(at(5, 4), 6);
    expect(at(2, 4)).toBeCloseTo(at(6, 4), 6);
  });

  test("borders mirror without repeating the edge sample", () => {
    // Reflect-101 reads the impulse at index 2 twice for the edge sample at
    // index 0 (offsets +2 and -2). Clamping or zero padding would read it once.
    const out = gaussianBlur(imageOf([[0, 0, 1, 0, 0]]), 1);
    expect(out.data[0]).toBeCloseTo(2 * gauss1(2), 6);
    expect(out.data[4]).toBeCloseTo(2 * gauss1(2), 6);
  });

  test("a flat image stays flat at every border, even when the kernel outruns it", () => {
    // sigma 2.5 gives radius 8, wider than the 7-pixel-wide image.
    const img = createImage(7, 6);
    img.data.fill(0.3);
    const out = gaussianBlur(img, 2.5);
    for (const v of out.data) expect(v).toBeCloseTo(0.3, 6);
  });
});

describe("localStd", () => {
  test("a flat image has no fine texture", () => {
    const img = createImage(21, 21);
    img.data.fill(0.6);
    const out = localStd(img, 1, 2);
    for (const v of out.data) expect(v).toBeCloseTo(0, 4);
  });

  test("a one-pixel checkerboard has local std 0.5 in its interior", () => {
    // A 1 px pattern survives the fine blur almost untouched, so the residual
    // is +-0.5 everywhere and its local std is 0.5 (less a 0.0002 leak).
    const img = createImage(21, 21);
    for (let y = 0; y < 21; y++)
      for (let x = 0; x < 21; x++) img.data[y * 21 + x] = (x + y) % 2;
    const out = localStd(img, 1, 2);
    expect(out.data[10 * 21 + 10]).toBeCloseTo(0.5, 3);
  });

  test("a smooth ramp has no fine texture in its interior", () => {
    const img = createImage(41, 41);
    for (let y = 0; y < 41; y++)
      for (let x = 0; x < 41; x++) img.data[y * 41 + x] = x / 40;
    const out = localStd(img, 1, 2);
    expect(out.data[20 * 41 + 20]).toBeLessThan(1e-4);
  });
});

describe("maskFrom", () => {
  test("keeps pixels strictly above the threshold", () => {
    const m = maskFrom(imageOf([[0.2, 0.5, 0.8]]), 0.5);
    expect(m.width).toBe(3);
    expect(m.height).toBe(1);
    expect(Array.from(m.data)).toEqual([0, 0, 1]);
  });
});

describe("erode and dilate", () => {
  const block = maskOf([
    ".....",
    ".###.",
    ".###.",
    ".###.",
    ".....",
  ]);

  test("erode with a radius-1 disc keeps only the centre of a 3x3 block", () => {
    expect(rowsOf(erode(block, 1))).toEqual([
      ".....",
      ".....",
      "..#..",
      ".....",
      ".....",
    ]);
  });

  test("dilate with a radius-1 disc adds edge neighbours but not corners", () => {
    expect(rowsOf(dilate(block, 1))).toEqual([
      ".###.",
      "#####",
      "#####",
      "#####",
      ".###.",
    ]);
  });

  test("the radius-2 disc is round: it reaches (2,0) and (1,1) but not (2,1)", () => {
    expect(rowsOf(dilate(centrePixel(), 2))).toEqual([
      ".......",
      "...#...",
      "..###..",
      ".#####.",
      "..###..",
      "...#...",
      ".......",
    ]);
  });

  test("outside the image counts as empty for erosion", () => {
    const full = maskOf(["#####", "#####", "#####", "#####", "#####"]);
    expect(rowsOf(erode(full, 1))).toEqual([
      ".....",
      ".###.",
      ".###.",
      ".###.",
      ".....",
    ]);
  });

  test("radius 0 changes nothing", () => {
    expect(rowsOf(erode(block, 0))).toEqual(rowsOf(block));
    expect(rowsOf(dilate(block, 0))).toEqual(rowsOf(block));
  });
});

describe("open and close", () => {
  test("open drops an isolated pixel and rounds a block into a plus", () => {
    // A plus-shaped disc cannot fit in the block's corners, so the block
    // erodes to its centre and dilates back as a plus.
    const m = maskOf([
      "#......",
      ".......",
      "..###..",
      "..###..",
      "..###..",
      ".......",
      ".......",
    ]);
    expect(rowsOf(open(m, 1))).toEqual([
      ".......",
      ".......",
      "...#...",
      "..###..",
      "...#...",
      ".......",
      ".......",
    ]);
  });

  test("close fills a one-pixel hole and leaves the block otherwise alone", () => {
    const solid = [
      ".........",
      ".........",
      "..#####..",
      "..#####..",
      "..#####..",
      "..#####..",
      "..#####..",
      ".........",
      ".........",
    ];
    const holed = [...solid];
    holed[4] = "..##.##..";
    expect(rowsOf(close(maskOf(holed), 1))).toEqual(solid);
  });
});

describe("connectedComponents", () => {
  const diagonal = maskOf(["#....", ".#...", "...##"]);

  test("4-connectivity keeps diagonal neighbours apart", () => {
    const c = connectedComponents(diagonal, 4);
    expect(c.count).toBe(3);
    expect(Array.from(c.labels)).toEqual([
      1, 0, 0, 0, 0,
      0, 2, 0, 0, 0,
      0, 0, 0, 3, 3,
    ]);
    expect(c.stats[0]).toEqual({ area: 1, x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0 });
    expect(c.stats[1]).toEqual({ area: 1, x0: 1, y0: 1, x1: 1, y1: 1, cx: 1, cy: 1 });
    expect(c.stats[2]).toEqual({ area: 2, x0: 3, y0: 2, x1: 4, y1: 2, cx: 3.5, cy: 2 });
  });

  test("8-connectivity joins diagonal neighbours", () => {
    const c = connectedComponents(diagonal, 8);
    expect(c.count).toBe(2);
    expect(Array.from(c.labels)).toEqual([
      1, 0, 0, 0, 0,
      0, 1, 0, 0, 0,
      0, 0, 0, 2, 2,
    ]);
    expect(c.stats[0]).toEqual({ area: 2, x0: 0, y0: 0, x1: 1, y1: 1, cx: 0.5, cy: 0.5 });
    expect(c.stats[1]).toEqual({ area: 2, x0: 3, y0: 2, x1: 4, y1: 2, cx: 3.5, cy: 2 });
  });

  test("two separate blobs get their own labels and boxes", () => {
    const c = connectedComponents(
      maskOf(["##...", "##.#.", "...#.", "...#."]),
      4,
    );
    expect(c.count).toBe(2);
    expect(Array.from(c.labels)).toEqual([
      1, 1, 0, 0, 0,
      1, 1, 0, 2, 0,
      0, 0, 0, 2, 0,
      0, 0, 0, 2, 0,
    ]);
    expect(c.stats[1]).toEqual({ area: 3, x0: 3, y0: 1, x1: 3, y1: 3, cx: 3, cy: 2 });
  });

  test("an empty mask has no components", () => {
    const c = connectedComponents(createMask(4, 4), 8);
    expect(c.count).toBe(0);
    expect(c.stats).toEqual([]);
  });

  test("a large region is one component (no recursion limit)", () => {
    const m = createMask(300, 300);
    m.data.fill(1);
    const c = connectedComponents(m, 4);
    expect(c.count).toBe(1);
    expect(c.stats[0].area).toBe(90000);
  });
});

describe("fillHoles", () => {
  test("a closed ring is filled, but the background touching the border is not", () => {
    const ring = [
      ".......",
      ".#####.",
      ".#...#.",
      ".#...#.",
      ".#...#.",
      ".#####.",
      ".......",
    ];
    expect(rowsOf(fillHoles(maskOf(ring)))).toEqual([
      ".......",
      ".#####.",
      ".#####.",
      ".#####.",
      ".#####.",
      ".#####.",
      ".......",
    ]);
  });

  test("a pocket that reaches the border through a gap stays empty", () => {
    const gapped = [
      ".......",
      ".##.##.",
      ".#...#.",
      ".#...#.",
      ".#...#.",
      ".#####.",
      ".......",
    ];
    expect(rowsOf(fillHoles(maskOf(gapped)))).toEqual(gapped);
  });
});

describe("distanceTransform", () => {
  test("distance from one outside pixel is the Euclidean distance", () => {
    const m = createMask(7, 7);
    m.data.fill(1);
    m.data[3 * 7 + 3] = 0;
    const d = distanceTransform(m);
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        expect(d.data[y * 7 + x]).toBeCloseTo(
          Math.sqrt((x - 3) ** 2 + (y - 3) ** 2),
          5,
        );
      }
    }
    // Pixels on the image edge are not outside, so the corner is not zero.
    expect(d.data[0]).toBeGreaterThan(4);
  });

  test("an all-inside mask gets the large finite stand-in distance", () => {
    const m = createMask(4, 3);
    m.data.fill(1);
    for (const v of distanceTransform(m).data) expect(v).toBe(1e6);
  });

  test("matches brute force on an irregular mask", () => {
    const rows = Array.from({ length: 13 }, (_, y) =>
      Array.from({ length: 17 }, (_, x) =>
        (x * x + 3 * y * y + x * y) % 5 === 0 ? "." : "#",
      ).join(""),
    );
    const m = maskOf(rows);
    const d = distanceTransform(m);
    const outside: [number, number][] = [];
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++)
        if (m.data[y * m.width + x] === 0) outside.push([x, y]);
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const i = y * m.width + x;
        if (m.data[i] === 0) {
          expect(d.data[i]).toBe(0);
          continue;
        }
        let best = Infinity;
        for (const [ox, oy] of outside)
          best = Math.min(best, Math.hypot(x - ox, y - oy));
        expect(d.data[i]).toBeCloseTo(best, 4);
      }
    }
  });
});

describe("largestComponent", () => {
  const two = maskOf(["##...", "##.#.", "...#.", "...#."]);

  test("keeps the component with the most pixels by default", () => {
    expect(rowsOf(largestComponent(two))).toEqual([
      "##...",
      "##...",
      ".....",
      ".....",
    ]);
  });

  test("prefer picks another component", () => {
    expect(rowsOf(largestComponent(two, (s) => s.cy))).toEqual([
      ".....",
      "...#.",
      "...#.",
      "...#.",
    ]);
  });

  test("an empty mask stays empty", () => {
    expect(rowsOf(largestComponent(createMask(3, 2)))).toEqual(["...", "..."]);
  });
});

describe("resizeArea", () => {
  test("halves a checkerboard to flat 0.5", () => {
    const img = imageOf([
      [0, 1, 0, 1],
      [1, 0, 1, 0],
      [0, 1, 0, 1],
      [1, 0, 1, 0],
    ]);
    const out = resizeArea(img, 2);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(Array.from(out.data)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  test("a fractional factor splits a sample between two cells by overlap", () => {
    // Three samples into two cells: cell 0 covers [0, 1.5), cell 1 covers
    // [1.5, 3). Cell 0 = (0.5 / 1.5) * 0.5 = 1/6. Cell 1 = (0.5 / 1.5) * 0.5
    // + (1 / 1.5) * 1 = 5/6.
    const out = resizeArea(imageOf([[0, 0.5, 1]]), 2);
    expect(out.height).toBe(1);
    expect(out.data[0]).toBeCloseTo(1 / 6, 6);
    expect(out.data[1]).toBeCloseTo(5 / 6, 6);
  });

  test("a constant image stays constant under a non-integer factor", () => {
    const img = createImage(7, 5);
    img.data.fill(0.3);
    const out = resizeArea(img, 3);
    expect(out.width).toBe(3);
    expect(out.height).toBe(2);
    for (const v of out.data) expect(v).toBeCloseTo(0.3, 6);
  });

  test("a wider target is bilinear upsampling with pixel-centre alignment", () => {
    const out = resizeArea(imageOf([[0, 1]]), 4);
    expect(out.width).toBe(4);
    expect(out.height).toBe(2);
    expect(Array.from(out.data)).toEqual([0, 0.25, 0.75, 1, 0, 0.25, 0.75, 1]);
  });

  test("the same width returns the same pixels", () => {
    const img = imageOf([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(Array.from(resizeArea(img, 3).data)).toEqual(Array.from(img.data));
  });
});

/** Erode or dilate straight from the disc definition, as a reference. */
function naiveMorph(m: Mask, r: number, eroding: boolean): Mask {
  const out = createMask(m.width, m.height);
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      let all = true;
      let any = false;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const xx = x + dx;
          const yy = y + dy;
          const inside =
            xx >= 0 &&
            yy >= 0 &&
            xx < m.width &&
            yy < m.height &&
            m.data[yy * m.width + xx] !== 0;
          if (inside) any = true;
          else all = false;
        }
      }
      out.data[y * m.width + x] = (eroding ? all : any) ? 1 : 0;
    }
  }
  return out;
}

describe("erode and dilate at large radii", () => {
  const W = 41;
  const H = 29;
  // Smooth blobs that touch the image edges, with a few holes punched in.
  const blobs = createMask(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v =
        Math.sin(0.4 * x + 0.3 * y) +
        Math.cos(0.23 * x - 0.5 * y) +
        0.4 * Math.sin(0.09 * x * y);
      const hole = (x * 7 + y * 13) % 19 === 0;
      blobs.data[y * W + x] = v > -0.2 && !hole ? 1 : 0;
    }
  }
  const full = createMask(W, H);
  full.data.fill(1);
  const empty = createMask(W, H);
  const corner = createMask(W, H);
  corner.data[0] = 1;

  const shapes: [string, Mask][] = [
    ["blobs", blobs],
    ["all inside", full],
    ["all outside", empty],
    ["one corner pixel", corner],
  ];
  for (const [name, m] of shapes) {
    for (const r of [4, 6, 9, 14]) {
      test(`${name}, radius ${r}: erode and dilate match the disc definition`, () => {
        expect(Array.from(erode(m, r).data)).toEqual(
          Array.from(naiveMorph(m, r, true).data),
        );
        expect(Array.from(dilate(m, r).data)).toEqual(
          Array.from(naiveMorph(m, r, false).data),
        );
      });
    }
  }
});
