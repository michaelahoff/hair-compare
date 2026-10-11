import { describe, expect, test } from "bun:test";

import { alignHeads, headFeatures, headScore } from "./head-align";
import { rng } from "./test-images";
import { applySimilarity, type Similarity } from "./transform";
import { createRgb, type RgbImage } from "../scalp/rgb";

/**
 * A top-down head on a tiled floor: a dark, finely textured disc of hair
 * with a pink two-lobed patch inside it (so the turn is not ambiguous), a
 * plain collar below, and beige tiles with grout lines behind.
 */
function scene(
  width: number,
  height: number,
  t: Similarity,
  seed: number,
): RgbImage {
  const rand = rng(seed);
  const img = createRgb(width, height);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Scene coordinates: undo `t` so the head is drawn where t puts it.
      const [u, v] = applySimilarity(t, (x - cx) / width, (y - cy) / width);
      let r = 205;
      let g = 185;
      let b = 150;
      // Faint grout every 0.12 units: tiles are low-contrast at this scale.
      if (Math.abs(((u + 10) % 0.12) - 0.06) < 0.004 || Math.abs(((v + 10) % 0.12) - 0.06) < 0.004) {
        r = 185;
        g = 168;
        b = 138;
      }
      const d = Math.hypot(u, v);
      if (v > 0.22 && Math.abs(u) < 0.45) {
        // Collar: plain light fabric.
        r = 235;
        g = 235;
        b = 230;
      }
      if (d < 0.2) {
        // Hair: dark with fine texture.
        const n = rand();
        r = 35 + n * 50;
        g = 30 + n * 45;
        b = 28 + n * 40;
        // Two-lobed pink patch, lobes toward -v.
        const lobe =
          Math.hypot(u - 0.045, v + 0.03) < 0.05 ||
          Math.hypot(u + 0.045, v + 0.03) < 0.05 ||
          Math.hypot(u, v + 0.01) < 0.06;
        if (lobe) {
          r = 225 + (rand() - 0.5) * 8;
          g = 175 + (rand() - 0.5) * 8;
          b = 165 + (rand() - 0.5) * 8;
        }
      }
      const i = (y * width + x) * 3;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
    }
  }
  return img;
}

const IDENTITY: Similarity = { tx: 0, ty: 0, rotation: 0, scale: 1 };

describe("alignHeads", () => {
  const ref = headFeatures(scene(192, 256, IDENTITY, 1));

  test("finds the head and its patch", () => {
    const share = ref.mask.data.reduce((n, v) => n + v, 0) / ref.mask.data.length;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.35);
  });

  test("recovers a turn, shift and zoom despite the floor", () => {
    const truth: Similarity = {
      tx: 0.06,
      ty: -0.04,
      rotation: (35 * Math.PI) / 180,
      scale: 1.15,
    };
    const target = headFeatures(scene(192, 256, truth, 2));
    const result = alignHeads(ref.levels, target.levels);
    // The scene draws the head where the *inverse* of `truth` puts it, so
    // the recovered map ref -> target is truth's inverse.
    const [px, py] = applySimilarity(result.transform, 0, 0);
    const [qx, qy] = applySimilarity(
      { ...truth, scale: 1 / truth.scale, rotation: -truth.rotation, tx: 0, ty: 0 },
      0,
      0,
    );
    expect(result.score).toBeGreaterThan(0.5);
    expect(Math.abs(result.transform.rotation + truth.rotation)).toBeLessThan(
      (6 * Math.PI) / 180,
    );
    expect(Math.abs(result.transform.scale * truth.scale - 1)).toBeLessThan(0.08);
    // The patch centre (scene origin) must land on the patch in the target.
    const inv = {
      scale: 1 / truth.scale,
      rotation: -truth.rotation,
      tx: 0,
      ty: 0,
    };
    const [ex, ey] = applySimilarity(inv, -truth.tx, -truth.ty);
    expect(Math.hypot(px - ex, py - ey)).toBeLessThan(0.03);
    expect(qx).toBe(0);
    expect(qy).toBe(0);
  });

  test("is not ambiguous for a two-lobed patch, and ranks any other turn lower", () => {
    const target = headFeatures(scene(192, 256, IDENTITY, 3));
    const result = alignHeads(ref.levels, target.levels);
    expect(result.alternatives.length).toBeGreaterThanOrEqual(1);
    expect(result.alternatives[0].score).toBe(result.score);
    expect(Math.abs(result.transform.rotation)).toBeLessThan((6 * Math.PI) / 180);
    expect(result.ambiguous).toBe(false);
    for (const other of result.alternatives.slice(1))
      expect(other.score).toBeLessThan(result.score - 0.05);
  });

  test("scores the true transform at least as well as a half turn", () => {
    const target = headFeatures(scene(192, 256, IDENTITY, 4));
    const right = headScore(ref.levels[0], target.levels[0], IDENTITY).score;
    const flipped = headScore(ref.levels[0], target.levels[0], {
      ...IDENTITY,
      rotation: Math.PI,
    }).score;
    expect(right).toBeGreaterThan(flipped);
  });
});
