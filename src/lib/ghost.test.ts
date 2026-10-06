import { describe, expect, test } from "bun:test";

import { warpImage } from "./alignment/image";
import { relight, syntheticScalp } from "./alignment/test-images";
import { IDENTITY, type Similarity } from "./alignment/transform";
import turned from "./fixtures/turned-frame.json";
import { guide } from "./ghost";

const W = 64;
const H = 85;
const ghost = syntheticScalp(W, H, 7);
/** What the camera would see if the ghost's content moved by `t`. */
const frame = (t: Partial<Similarity>, seed = 3) =>
  relight(
    warpImage(ghost, { ...IDENTITY, ...t }, W, H, 0.15),
    1,
    0,
    0.03,
    seed,
  );

describe("ghost guidance", () => {
  test("an aligned, equally lit frame is a match", () => {
    const g = guide(ghost, frame({}));
    expect(g.matched).toBe(true);
    expect(g.hint).toBe("hold");
    expect(g.match).toBe(1);
  });

  test("content too large means the camera is too close", () => {
    const g = guide(ghost, frame({ scale: 1.25 }));
    expect(g.matched).toBe(false);
    expect(g.hint).toBe("farther");
    expect(g.offset.scale).toBeGreaterThan(1.15);
  });

  test("content too small means the camera is too far", () => {
    expect(guide(ghost, frame({ scale: 0.8 })).hint).toBe("closer");
  });

  test("rotation hints flip with a mirrored preview", () => {
    const turned = frame({ rotation: (15 * Math.PI) / 180 });
    expect(guide(ghost, turned).hint).toBe("rotate-cw");
    expect(guide(ghost, turned, { mirrored: true }).hint).toBe("rotate-ccw");
  });

  test("a shifted frame asks to line up and reports the offset", () => {
    const g = guide(ghost, frame({ tx: 0.12 }));
    expect(g.hint).toBe("line-up");
    expect(g.offset.tx).toBeCloseTo(0.12, 1);
    expect(
      guide(ghost, frame({ tx: 0.12 }), { mirrored: true }).offset.tx,
    ).toBeCloseTo(-0.12, 1);
    expect(g.match).toBeLessThan(1);
  });

  test("lighting is checked even when framing is perfect", () => {
    const dark = relight(frame({}), 0.6, 0, 0, 1);
    const g = guide(ghost, dark);
    expect(g.matched).toBe(false);
    expect(g.hint).toBe("too-dark");
    expect(guide(ghost, relight(frame({}), 1.5, 0, 0, 1)).hint).toBe(
      "too-bright",
    );
  });

  test("a featureless frame is not trusted", () => {
    const blank = relight(frame({}), 0, 0.4, 0, 1);
    const g = guide(ghost, blank);
    expect(g.matched).toBe(false);
    expect(g.match).toBe(0);
  });

  test("a recorded live frame turned 14° is caught, not matched", () => {
    const gray = (b64: string) => ({
      width: turned.width,
      height: turned.height,
      data: Float32Array.from(Buffer.from(b64, "base64"), (v) => v / 255),
    });
    const g = guide(gray(turned.ghost), gray(turned.frame));
    expect(g.matched).toBe(false);
    expect(g.hint).toBe("rotate-cw");
    expect((g.offset.rotation * 180) / Math.PI).toBeCloseTo(
      turned.rotationDeg,
      0,
    );
  });
});
