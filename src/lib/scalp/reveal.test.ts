import { describe, expect, test } from "bun:test";
import { toByteArray } from "base64-js";

import { createImage, type GrayImage } from "../alignment/image";
import { createRgb, type RgbImage } from "./rgb";
import { pngDataUri, revealLuma, revealRgb, tintLines } from "./reveal";

const N = 200;
const LINE_X = 100;
const DIP = 6;

/** Ramp 90..110 across the image, with a 1-px vertical line DIP levels down. */
function rampWithLine(): GrayImage {
  const img = createImage(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      img.data[y * N + x] = 90 + (20 * x) / (N - 1) - (x === LINE_X ? DIP : 0);
    }
  }
  return img;
}

/**
 * How far the line sits below the pixels `reach` columns either side of it,
 * averaged over all rows. Positive means the line is darker.
 */
function lineContrast(img: GrayImage, reach: number): number {
  let sum = 0;
  for (let y = 0; y < N; y++) {
    const i = y * N + LINE_X;
    sum += (img.data[i - reach] + img.data[i + reach]) / 2 - img.data[i];
  }
  return sum / N;
}

function meanOf(img: GrayImage): number {
  let sum = 0;
  for (const v of img.data) sum += v;
  return sum / img.data.length;
}

/** Pink skin (230, 180, 170) with a faint neutral grey line in column 100. */
function pinkWithGreyLine(): RgbImage {
  const img = createRgb(N, N);
  for (let i = 0; i < N * N; i++) {
    const x = i % N;
    const j = i * 3;
    const grey = x === LINE_X;
    img.data[j] = grey ? 185 : 230;
    img.data[j + 1] = grey ? 185 : 180;
    img.data[j + 2] = grey ? 185 : 170;
  }
  return img;
}

describe("revealLuma", () => {
  test("a faint 1-px line gets 3x its contrast; the mean stays near 128", () => {
    const before = rampWithLine();
    const after = revealLuma(before);
    // Measured 3 columns out, clear of the line's own blur.
    expect(lineContrast(before, 3)).toBeCloseTo(DIP, 3);
    expect(lineContrast(after, 3)).toBeGreaterThanOrEqual(
      3 * lineContrast(before, 3),
    );
    expect(Math.abs(meanOf(after) - 128)).toBeLessThanOrEqual(10);
  });

  test("a flat image stays at 128 (no noise amplification)", () => {
    const flat = createImage(N, N);
    flat.data.fill(128);
    const out = revealLuma(flat);
    for (const v of out.data) expect(Math.abs(v - 128)).toBeLessThanOrEqual(1);
  });

  test("output stays within 0..255 on a hard edge", () => {
    const edge = createImage(N, N);
    for (let i = 0; i < edge.data.length; i++) {
      edge.data[i] = i % N < N / 2 ? 0 : 255;
    }
    const out = revealLuma(edge, { gain: 10, sharpen: 2 });
    for (const v of out.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe("revealRgb", () => {
  test("a grey line on pink stays neutral; pink background keeps R > G > B", () => {
    const out = revealRgb(pinkWithGreyLine());
    const at = (x: number, y: number) => {
      const j = (y * N + x) * 3;
      return [out.data[j], out.data[j + 1], out.data[j + 2]];
    };
    const [lr, lg, lb] = at(LINE_X, 100);
    expect(lg).toBeGreaterThan(0);
    expect(Math.abs(lr - lg) / lg).toBeLessThanOrEqual(0.05);
    expect(Math.abs(lb - lg) / lg).toBeLessThanOrEqual(0.05);
    const [br, bg, bb] = at(10, 100);
    expect(br).toBeGreaterThan(bg);
    expect(bg).toBeGreaterThan(bb);
    // The line is still darker than the background after the reveal.
    expect(lg).toBeLessThan(bg);
  });
});

describe("tintLines", () => {
  const W = 7;
  const H = 7;
  const base: [number, number, number] = [200, 100, 40];
  const color: [number, number, number] = [255, 0, 255];

  function solid(): RgbImage {
    const img = createRgb(W, H);
    for (let i = 0; i < W * H; i++) img.data.set(base, i * 3);
    return img;
  }

  test("paints line + 4-neighbours and halves masked-out pixels", () => {
    const lines = new Uint8Array(W * H);
    lines[3 * W + 3] = 1; // centre
    lines[5 * W + 0] = 1; // left edge: no wrap into the row above
    const mask = new Uint8Array(W * H).fill(1);
    mask[0] = 0; // top-left corner, masked out
    mask[6 * W + 6] = 0; // bottom-right corner, masked out

    const tinted = new Set([
      "3,3", "2,3", "4,3", "3,2", "3,4", // centre and its 4-neighbours
      "0,5", "0,4", "0,6", "1,5", // left-edge line and its neighbours
    ]);
    const out = tintLines(solid(), lines, color, mask);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const j = (y * W + x) * 3;
        const px = [out.data[j], out.data[j + 1], out.data[j + 2]];
        if (tinted.has(`${x},${y}`)) {
          expect(px).toEqual(color);
        } else if (mask[y * W + x] === 0) {
          expect(px).toEqual([100, 50, 20]);
        } else {
          expect(px).toEqual(base);
        }
      }
    }
  });

  test("returns a copy and leaves the input untouched", () => {
    const img = solid();
    const lines = new Uint8Array(W * H);
    lines[0] = 1;
    tintLines(img, lines, color);
    expect(Array.from(img.data.slice(0, 3))).toEqual(base);
  });
});

describe("pngDataUri", () => {
  test("is a PNG data URI whose header gives the same size", () => {
    const img = createRgb(64, 48);
    for (let i = 0; i < 64 * 48; i++) img.data.set([200, 100, 40], i * 3);
    const uri = pngDataUri(img);
    const prefix = "data:image/png;base64,";
    expect(uri.startsWith(prefix)).toBe(true);

    const bytes = toByteArray(uri.slice(prefix.length));
    // PNG signature, then the IHDR chunk type, then width and height
    // (big-endian).
    expect(Array.from(bytes.slice(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(String.fromCharCode(...bytes.slice(12, 16))).toBe("IHDR");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(16)).toBe(64);
    expect(view.getUint32(20)).toBe(48);
  });
});
