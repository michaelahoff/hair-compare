import { describe, expect, test } from "bun:test";
import { applySimilarity, type Similarity } from "./alignment/transform";
import { baseBox, chainFraming, compose, framingOf } from "./framing";
import { guideCarry } from "./guide-art";

const close = (a: number[], b: number[]) =>
  a.forEach((value, i) => expect(value).toBeCloseTo(b[i], 9));

describe("framing", () => {
  test("ignores legacy pair alignments", () => {
    expect(framingOf({ view: "top", alignment: null })).toBeNull();
    expect(
      framingOf({
        view: "top",
        alignment: { tx: 0, ty: 0, rotation: 0, scale: 1, refPhotoId: "a" },
      }),
    ).toBeNull();
    const framing = { tx: 0.1, ty: 0, rotation: 0.2, scale: 1.3 };
    expect(framingOf({ view: "top", alignment: framing })).toEqual(framing);
  });
  test("reads a framing on either picture, whichever it was placed on", () => {
    const onHead = {
      tx: 0.1,
      ty: 0.02,
      rotation: 0.3,
      scale: 1.2,
      source: "manual" as const,
    };
    const head = { view: "top" as const, alignment: onHead };
    const closeup = framingOf(head, "closeup")!;
    expect(closeup).toMatchObject({
      ...compose(guideCarry("top", "head", "closeup"), onHead),
      source: "manual",
      guide: "closeup",
    });
    // Stored as placed on the close-up, it reads back the same on both.
    const stored = { view: "top" as const, alignment: closeup };
    expect(framingOf(stored, "closeup")).toEqual(closeup);
    const back = framingOf(stored)!;
    close([back.tx, back.ty, back.rotation, back.scale], [0.1, 0.02, 0.3, 1.2]);
    expect(back.guide).toBeUndefined();
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
