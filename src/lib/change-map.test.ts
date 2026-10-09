import { describe, expect, test } from "bun:test";

import { createImage, warpImage, type GrayImage } from "./alignment/image";
import { relight, rng, syntheticScalp } from "./alignment/test-images";
import { IDENTITY } from "./alignment/transform";
import {
  BLOCK,
  CHANGE_THRESHOLD,
  changeConfidence,
  computeChangeMap,
  GUIDE_SIZE,
  matchScore,
  type ChangeMap,
  type GuideMask,
} from "./change-map";
import { baseBox, compose } from "./framing";
import turned from "./fixtures/turned-frame.json";

const S = GUIDE_SIZE;
const N = S / BLOCK;
const full = (): GuideMask => new Uint8Array(S * S).fill(1);
const alpha = (map: ChangeMap, bx: number, by: number) =>
  map.rgba[(by * N + bx) * 4 + 3];
const value = (map: ChangeMap, bx: number, by: number) =>
  map.values[by * N + bx];

/** Short dark hair-like strokes, 1 px wide, with centres inside `rect`. */
function addStrokes(
  img: GrayImage,
  rect: [number, number, number, number],
  count: number,
  seed: number,
): GrayImage {
  const out = createImage(img.width, img.height);
  out.data.set(img.data);
  const rand = rng(seed);
  const [x0, y0, x1, y1] = rect;
  for (let k = 0; k < count; k++) {
    const cx = x0 + rand() * (x1 - x0);
    const cy = y0 + rand() * (y1 - y0);
    const length = 6 + rand() * 6;
    const angle = rand() * Math.PI;
    for (let t = -length / 2; t <= length / 2; t += 0.5) {
      const x = Math.round(cx + Math.cos(angle) * t);
      const y = Math.round(cy + Math.sin(angle) * t);
      if (x >= x0 && x < x1 && y >= y0 && y < y1)
        out.data[y * S + x] -= 0.25;
    }
  }
  return out;
}

const base = syntheticScalp(S, S, 1);
const before = relight(base, 1, 0, 0.03, 2);
/** Blocks 4–10 across and 6–12 down cover the rectangle x 64–176, y 96–208. */
const RECT: [number, number, number, number] = [64, 96, 176, 208];

describe("computeChangeMap", () => {
  test("identical inputs are fully transparent", () => {
    const map = computeChangeMap(before, before, {
      before: full(),
      after: full(),
    });
    for (let i = 3; i < map.rgba.length; i += 4) expect(map.rgba[i]).toBe(0);
    expect(map.gained).toBe(0);
    expect(map.lost).toBe(0);
    expect(map.coverage).toBe(1);
  });

  test("added strokes read as gained texture there and nowhere else", () => {
    const after = addStrokes(relight(base, 1, 0, 0.03, 3), RECT, 300, 9);
    const map = computeChangeMap(before, after, {
      before: full(),
      after: full(),
    });

    const inside: number[] = [];
    for (let by = 0; by < N; by++) {
      for (let bx = 0; bx < N; bx++) {
        // Distance in blocks outside the rectangle; 0 means inside it.
        const away = Math.max(4 - bx, bx - 10, 6 - by, by - 12, 0);
        if (away === 0 && bx >= 5 && bx <= 9 && by >= 7 && by <= 11)
          inside.push(value(map, bx, by));
        if (away > 1) expect(alpha(map, bx, by)).toBe(0);
      }
    }
    const positive = inside.filter((v) => v > CHANGE_THRESHOLD).length;
    expect(positive / inside.length).toBeGreaterThanOrEqual(0.8);
    expect(map.gained).toBeGreaterThan(0);
    expect(map.lost).toBeLessThanOrEqual(0.01);
  });

  test("a brightness and contrast shift alone changes nothing", () => {
    const after = relight(before, 0.7, 0.12, 0.03, 4);
    const map = computeChangeMap(before, after, {
      before: full(),
      after: full(),
    });
    for (let i = 3; i < map.rgba.length; i += 4) expect(map.rgba[i]).toBe(0);
    expect(map.gained).toBe(0);
    expect(map.lost).toBe(0);
  });

  test("pixels outside a mask are ignored whatever their value", () => {
    const afterMask = full();
    for (let y = 0; y < S; y++)
      for (let x = S / 2; x < S; x++) afterMask[y * S + x] = 0;
    const withGarbage = (seed: number) => {
      const after = relight(before, 1, 0, 0.03, 3);
      const rand = rng(seed);
      for (let y = 0; y < S; y++)
        for (let x = S / 2; x < S; x++)
          after.data[y * S + x] = rand() * 100 - 50;
      return after;
    };
    const masks = { before: full(), after: afterMask };
    const map = computeChangeMap(before, withGarbage(5), masks);
    const other = computeChangeMap(before, withGarbage(6), masks);

    expect(map.coverage).toBeCloseTo(0.5, 1);
    for (let by = 0; by < N; by++) {
      for (let bx = 0; bx < N; bx++) {
        if (bx < N / 2) {
          expect(alpha(map, bx, by)).toBe(0);
          expect(value(map, bx, by)).toBe(value(other, bx, by));
        } else {
          expect(Number.isNaN(value(map, bx, by))).toBe(true);
          expect(alpha(map, bx, by)).toBe(0);
        }
      }
    }
  });
});

describe("turned-frame fixture", () => {
  const W = turned.width;
  const H = turned.height;
  const ghost: GrayImage = {
    width: W,
    height: H,
    data: Float32Array.from(
      Buffer.from(turned.ghost, "base64"),
      (v) => v / 255,
    ),
  };
  // Clockwise quarter turn: the top row becomes the right-hand column.
  const turnedGhost = createImage(H, W);
  for (let r = 0; r < W; r++)
    for (let c = 0; c < H; c++)
      turnedGhost.data[r * H + c] = ghost.data[(H - 1 - c) * W + r];

  // Mirrors guideGray in photos.ts, without the image-manipulator decode.
  const toGuide = (
    src: GrayImage,
    photo: { width: number; height: number },
    framing: typeof IDENTITY,
  ) => {
    const image = warpImage(
      src,
      compose(framing, { ...IDENTITY, scale: baseBox(photo).width }),
      S,
      S,
      Number.NaN,
    );
    const mask = new Uint8Array(S * S);
    for (let i = 0; i < mask.length; i++) {
      if (Number.isNaN(image.data[i])) image.data[i] = 0;
      else mask[i] = 1;
    }
    return { image, mask };
  };
  const photoA = toGuide(ghost, { width: W, height: H }, IDENTITY);
  const turnedSize = { width: H, height: W };
  const photoB = toGuide(turnedGhost, turnedSize, {
    ...IDENTITY,
    rotation: -Math.PI / 2,
  });
  const photoBUnturned = toGuide(turnedGhost, turnedSize, IDENTITY);

  test("a 90 degree turn undone by its framing yields an empty map", () => {
    const masks = { before: photoA.mask, after: photoB.mask };
    const map = computeChangeMap(photoA.image, photoB.image, masks);
    expect(map.gained + map.lost).toBeLessThanOrEqual(0.05);
    expect(matchScore(photoA.image, photoB.image, masks)).toBeGreaterThan(0.8);
  });

  test("the turned photo without its framing lines up clearly worse", () => {
    const masks = {
      before: photoA.mask,
      after: photoBUnturned.mask,
    };
    expect(
      matchScore(photoA.image, photoBUnturned.image, masks),
    ).toBeLessThan(0.5);
  });
});

describe("matchScore", () => {
  test("identical renders match", () => {
    expect(
      matchScore(before, before, { before: full(), after: full() }),
    ).toBeGreaterThan(0.95);
  });

  test("a render shifted by 12 px matches clearly worse", () => {
    const shifted = warpImage(before, { ...IDENTITY, tx: 12 / S }, S, S, 0);
    const masks = { before: full(), after: full() };
    expect(matchScore(before, shifted, masks)).toBeLessThan(0.5);
  });

  test("returns -1 when the renders share almost no pixels", () => {
    const left = full();
    const right = full();
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        if (x < S / 2) right[y * S + x] = 0;
        else left[y * S + x] = 0;
      }
    expect(matchScore(before, before, { before: left, after: right })).toBe(
      -1,
    );
  });
});

describe("performance", () => {
  test("a guide-size pair maps in under 500 ms", () => {
    const after = addStrokes(relight(base, 1, 0, 0.03, 3), RECT, 300, 9);
    const started = performance.now();
    computeChangeMap(before, after, { before: full(), after: full() });
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("changeConfidence", () => {
  const same = { hair_length: "short" as const, hair_wet: false };
  const ok = { coverage: 1, match: 0.9, minMatch: 0.3 };

  test("a different hair length is low confidence", () => {
    expect(
      changeConfidence({
        ...ok,
        before: same,
        after: { hair_length: "long", hair_wet: false },
      }),
    ).toEqual({
      confidence: "low",
      reason: "Low confidence: different hair length",
    });
  });

  test("a different length and wetness are both named", () => {
    expect(
      changeConfidence({
        ...ok,
        before: same,
        after: { hair_length: "long", hair_wet: true },
      }),
    ).toEqual({
      confidence: "low",
      reason: "Low confidence: different hair length and wetness",
    });
  });

  test("little overlap is low confidence", () => {
    expect(
      changeConfidence({ ...ok, coverage: 0.5, before: same, after: same }),
    ).toMatchObject({ confidence: "low" });
  });

  test("a match below the minimum is low confidence", () => {
    expect(
      changeConfidence({ ...ok, match: 0.1, before: same, after: same }),
    ).toMatchObject({ confidence: "low" });
  });

  test("matching conditions are ok with no reason", () => {
    expect(changeConfidence({ ...ok, before: same, after: same })).toEqual({
      confidence: "ok",
      reason: null,
    });
  });

  test("an unknown hair length on one side is not a difference", () => {
    expect(
      changeConfidence({
        ...ok,
        before: { hair_length: null, hair_wet: false },
        after: { hair_length: "long", hair_wet: false },
      }),
    ).toEqual({ confidence: "ok", reason: null });
  });
});
