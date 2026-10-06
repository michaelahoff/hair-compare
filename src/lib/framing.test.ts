import { describe, expect, test } from "bun:test";
import { applySimilarity, type Similarity } from "./alignment/transform";
import { baseBox, chainFraming, compose, framingOf } from "./framing";

const close = (a: number[], b: number[]) =>
  a.forEach((value, i) => expect(value).toBeCloseTo(b[i], 9));

describe("framing", () => {
  test("ignores legacy pair alignments", () => {
    expect(framingOf({ alignment: null })).toBeNull();
    expect(
      framingOf({
        alignment: { tx: 0, ty: 0, rotation: 0, scale: 1, refPhotoId: "a" },
      }),
    ).toBeNull();
    const framing = { tx: 0.1, ty: 0, rotation: 0.2, scale: 1.3 };
    expect(framingOf({ alignment: framing })).toEqual(framing);
  });
  test("contains photos in the guide square", () => {
    expect(baseBox({ width: 300, height: 400 })).toEqual({
      width: 0.75,
      height: 1,
    });
    expect(baseBox({ width: 400, height: 200 })).toEqual({
      width: 1,
      height: 0.5,
    });
  });
  test("composes right to left", () => {
    const a: Similarity = { tx: 0.1, ty: -0.2, rotation: 0.4, scale: 1.5 };
    const b: Similarity = { tx: -0.3, ty: 0.05, rotation: -1.1, scale: 0.7 };
    const p: [number, number] = [0.21, -0.13];
    close(
      applySimilarity(compose(a, b), ...p),
      applySimilarity(a, ...applySimilarity(b, ...p)),
    );
  });
  test("matching points of chained photos land on the same guide spot", () => {
    const reference = { width: 300, height: 400 };
    const target = { width: 400, height: 300 };
    const referenceFraming = { tx: 0.05, ty: -0.1, rotation: 0.3, scale: 1.4 };
    const registration = { tx: -0.08, ty: 0.12, rotation: -0.7, scale: 0.85 };
    const framing = chainFraming(
      reference,
      referenceFraming,
      target,
      registration,
    );
    // A point in the reference, in its own width units, and its match.
    for (const p of [
      [0, 0],
      [0.3, -0.2],
      [-0.25, 0.4],
    ] as [number, number][]) {
      const q = applySimilarity(registration, ...p);
      const refWidth = baseBox(reference).width;
      const targetWidth = baseBox(target).width;
      close(
        applySimilarity(framing, q[0] * targetWidth, q[1] * targetWidth),
        applySimilarity(referenceFraming, p[0] * refWidth, p[1] * refWidth),
      );
    }
  });
});
