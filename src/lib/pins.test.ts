import { describe, expect, test } from "bun:test";
import { IDENTITY, type Similarity } from "./alignment/transform";
import { photoToGuide, type Point } from "./outline";
import { fitToPins, nextSpot, pairPins, pinAt, pinsFromMatch, type PairPin } from "./pins";

const before = { width: 600, height: 800 };
const after = { width: 800, height: 600 };
const beforeFraming: Similarity = { tx: 0.02, ty: -0.03, rotation: 0.2, scale: 1.1 };

function expectClose(a: Point, b: Point) {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
}
/** Where a pin of each photo lands on the guide, after fitting. */
function onGuide(pin: PairPin, afterFraming: Similarity) {
  return {
    before: photoToGuide([pin.before], before, beforeFraming)[0],
    after: photoToGuide([pin.after], after, afterFraming)[0],
  };
}

describe("fitToPins", () => {
  test("no pins leaves the after photo where it is", () => {
    expect(fitToPins(before, beforeFraming, after, IDENTITY, [])).toEqual(IDENTITY);
  });

  test("one pin only shifts the after photo, onto the before photo's pin", () => {
    const pin: PairPin = { id: "whorl", name: "Whorl", before: { x: 0.4, y: 0.6 }, after: { x: 0.7, y: 0.2 } };
    const fitted = fitToPins(before, beforeFraming, after, IDENTITY, [pin]);
    expect(fitted.rotation).toBe(0);
    expect(fitted.scale).toBe(1);
    const at = onGuide(pin, fitted);
    expectClose(at.after, at.before);
  });

  test("two pins also turn and scale it, so both land", () => {
    const pins: PairPin[] = [
      { id: "whorl", name: "Whorl", before: { x: 0.4, y: 0.6 }, after: { x: 0.7, y: 0.2 } },
      { id: "ear", name: "Ear", before: { x: 0.1, y: 0.5 }, after: { x: 0.55, y: 0.8 } },
    ];
    const fitted = fitToPins(before, beforeFraming, after, IDENTITY, pins);
    for (const pin of pins) {
      const at = onGuide(pin, fitted);
      expectClose(at.after, at.before);
    }
  });
});

describe("pairPins", () => {
  test("a pin stored on one photo starts on the other where the framings carry it", () => {
    const afterFraming: Similarity = { tx: -0.1, ty: 0.05, rotation: -0.4, scale: 0.9 };
    const pins = pairPins(
      before,
      beforeFraming,
      [{ id: "whorl", name: "Whorl", x: 0.4, y: 0.6 }],
      after,
      afterFraming,
      [],
    );
    expect(pins).toHaveLength(1);
    const at = {
      before: photoToGuide([pins[0].before], before, beforeFraming)[0],
      after: photoToGuide([pins[0].after], after, afterFraming)[0],
    };
    expectClose(at.after, at.before);
  });
});

describe("pinAt", () => {
  test("the guide's centre is an unframed photo's centre", () => {
    expectClose(pinAt(50, 50, before, IDENTITY), { x: 0.5, y: 0.5 });
  });
});

describe("pinsFromMatch", () => {
  test("keeps the spots that agree and drops one that doesn't", () => {
    const sizes = { a: { width: 576, height: 768 }, b: { width: 576, height: 768 } };
    // B is A shifted right by 40 px; the last point disagrees.
    const points = [
      [100, 100], [400, 120], [300, 500], [150, 650], [480, 600],
    ].map(([x, y], i) => ({ feature: `spot ${i}`, a: { x, y }, b: { x: x + 40, y } }));
    points.push({ feature: "a mistake", a: { x: 200, y: 200 }, b: { x: 500, y: 700 } });
    const pins = pinsFromMatch(points, sizes, 0.05, "ai-x");
    expect(pins.map((p) => p.name)).toEqual(["Spot 0", "Spot 1", "Spot 2", "Spot 3", "Spot 4"]);
    expect(pins[0].id).toBe("ai-x-1");
    expect(pins[0].before).toEqual({ x: 100 / 576, y: 100 / 768 });
  });
});

describe("nextSpot", () => {
  test("never leaves two pins alike after a spot is removed", () => {
    const one = nextSpot([], "a");
    const two = nextSpot([one], "b");
    // Spot 1 removed: the next is Spot 3, not a second Spot 2.
    const three = nextSpot([two], "c");
    expect([one.name, two.name, three.name]).toEqual(["Spot 1", "Spot 2", "Spot 3"]);
    expect(new Set([one.id, two.id, three.id]).size).toBe(3);
  });
});
