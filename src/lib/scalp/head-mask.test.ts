import { describe, expect, test } from "bun:test";

import { rng } from "../alignment/test-images";
import { headMask, patchCentre, skinMap } from "./head-mask";
import { createRgb, type RgbImage } from "./rgb";

const W = 256;
const H = 200;
const HAIR = { x: 128, y: 100, r: 70 };
const PATCH = { x: 110, y: 88, r: 25 };

type Disc = { x: number; y: number; r: number };
const inDisc = (d: Disc, x: number, y: number) =>
  (x - d.x) ** 2 + (y - d.y) ** 2 <= d.r ** 2;

/**
 * A beige scalp photo: a dark, noisy disc standing in for hair, with a smooth
 * pink patch of bare skin inside it. The noise is seeded so the test repeats.
 */
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

const img = syntheticHead();
const { mask, skin } = headMask(img);
const skinAll = skinMap(img);

describe("headMask", () => {
  test("covers the hair disc and little of the background", () => {
    let discTotal = 0;
    let discInside = 0;
    let outsideTotal = 0;
    let outsideInside = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inside = mask.data[y * W + x] === 1;
        if (inDisc(HAIR, x, y)) {
          discTotal++;
          if (inside) discInside++;
        } else {
          outsideTotal++;
          if (inside) outsideInside++;
        }
      }
    }
    expect(discInside / discTotal).toBeGreaterThan(0.85);
    // The mask spills about 7 px past the rim: the texture window bleeds the
    // hair noise into the beige, which reads as reddish. The Python prototype
    // gives the same spill (about 9% of the background) on this image.
    expect(outsideInside / outsideTotal).toBeLessThan(0.15);
  });

  test("the pink patch is inside the mask", () => {
    let missing = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (inDisc(PATCH, x, y) && mask.data[y * W + x] !== 1) missing++;
      }
    }
    expect(missing).toBe(0);
  });
});

describe("patchCentre", () => {
  test("lands near the pink patch", () => {
    // The spill ring around the disc carries a little skin weight and pulls
    // the centroid toward the disc centre, so the error is a few pixels.
    const centre = patchCentre(skin, mask, 4);
    expect(centre).not.toBeNull();
    expect(Math.hypot(centre!.x - PATCH.x, centre!.y - PATCH.y)).toBeLessThan(8);
  });

  test("is null when the mask holds no skin", () => {
    const empty = { width: W, height: H, data: new Uint8Array(W * H) };
    expect(patchCentre(skin, empty, 4)).toBeNull();
  });
});

describe("skinMap", () => {
  test("is above 0.5 on the pink patch", () => {
    let low = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (inDisc(PATCH, x, y) && !(skinAll.data[y * W + x] > 0.5)) low++;
      }
    }
    expect(low).toBe(0);
  });

  test("is low on the beige background and on the dark hair", () => {
    // Beige (200, 180, 150) gives Cr about 140, just above the ramp's start at
    // 138, so it reads as 0.20 rather than 0. The bound allows for that.
    let beigeMax = 0;
    let hairMax = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = skinAll.data[y * W + x];
        if (!inDisc(HAIR, x, y)) beigeMax = Math.max(beigeMax, v);
        else if (!inDisc(PATCH, x, y)) hairMax = Math.max(hairMax, v);
      }
    }
    expect(beigeMax).toBeLessThan(0.25);
    expect(hairMax).toBeLessThan(0.1);
  });
});

describe("headMask with no head", () => {
  test("a plain beige frame gives an empty mask, not a full one", () => {
    const flat = createRgb(W, H);
    for (let i = 0; i < W * H; i++) flat.data.set([200, 180, 150], i * 3);
    const { mask: none } = headMask(flat);
    expect(none.data.includes(1)).toBe(false);
  });
});
