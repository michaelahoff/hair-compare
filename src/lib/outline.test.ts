import { describe, expect, test } from "bun:test";
import { IDENTITY, type Similarity } from "./alignment/transform";
import {
  centroid,
  mapBetweenPhotos,
  orientClockwise,
  photoToGuide,
  regionPolygon,
  resample,
  type Point,
} from "./outline";

/** Clockwise on screen (y down). */
const SQUARE: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const twiceArea = (points: Point[]) =>
  points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0);

const gap = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

function expectPoints(actual: Point[], expected: Point[]) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((p, i) => {
    expect(p.x).toBeCloseTo(expected[i].x, 9);
    expect(p.y).toBeCloseTo(expected[i].y, 9);
  });
}

describe("regionPolygon", () => {
  test("falls back to the box's corners, clockwise from the top left", () => {
    expect(
      regionPolygon({
        area: "crown",
        box: { x: 0.25, y: 0.25, width: 0.5, height: 0.25 },
      }),
    ).toEqual([
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.5 },
      { x: 0.25, y: 0.5 },
    ]);
  });
  test("prefers an outline of at least three points", () => {
    const outline = [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.1 },
      { x: 0.2, y: 0.5 },
    ];
    expect(
      regionPolygon({
        area: "crown",
        box: { x: 0, y: 0, width: 1, height: 1 },
        outline,
      }),
    ).toEqual(outline);
  });
  test("ignores an outline with fewer than three points", () => {
    expect(
      regionPolygon({
        area: "crown",
        box: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
        outline: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      })?.length,
    ).toBe(4);
  });
  test("is null without a box or a usable outline", () => {
    expect(regionPolygon({ area: "crown", box: null })).toBeNull();
    expect(
      regionPolygon({ area: "crown", box: null, outline: null }),
    ).toBeNull();
  });
});

describe("orientClockwise", () => {
  test("reverses a counter-clockwise ring", () => {
    const counter = [...SQUARE].reverse();
    expect(twiceArea(counter)).toBeLessThan(0);
    expect(orientClockwise(counter)).toEqual(SQUARE);
  });
  test("keeps a clockwise ring in order", () => {
    expect(orientClockwise(SQUARE)).toEqual(SQUARE);
  });
});

describe("resample", () => {
  test("returns the requested number of points", () => {
    expect(resample(SQUARE).length).toBe(24);
    expect(resample(SQUARE, 8).length).toBe(8);
  });
  test("spaces points evenly along the perimeter, closing the ring", () => {
    // The square's corners fall on samples, so every gap is perimeter / 24.
    const samples = resample(SQUARE);
    samples.forEach((p, i) => {
      expect(gap(p, samples[(i + 1) % samples.length])).toBeCloseTo(4 / 24, 9);
    });
  });
  test("starts at the top of the shape, above the centroid", () => {
    expectPoints([resample(SQUARE)[0]], [{ x: 0.5, y: 0 }]);
  });
  test("does not depend on extra points along an edge", () => {
    const withMidpoints: Point[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.5 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expectPoints(resample(withMidpoints), resample(SQUARE));
  });
  test("gives the same samples whichever way the outline winds", () => {
    expectPoints(resample([...SQUARE].reverse()), resample(SQUARE));
  });
  test("stays finite for collinear and repeated points", () => {
    const collinear = resample([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    const repeated = resample([
      { x: 0.3, y: 0.3 },
      { x: 0.3, y: 0.3 },
      { x: 0.3, y: 0.3 },
    ]);
    for (const p of [...collinear, ...repeated]) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
    expect(repeated[5]).toEqual({ x: 0.3, y: 0.3 });
  });
});

describe("centroid", () => {
  test("of a square is its middle", () => {
    expect(
      centroid([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ]),
    ).toEqual({ x: 1, y: 1 });
  });
  test("of a triangle is the mean of its corners", () => {
    const at = centroid([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 0, y: 3 },
    ]);
    expect(at.x).toBeCloseTo(2, 9);
    expect(at.y).toBeCloseTo(1, 9);
  });
  test("of collinear points is their mean", () => {
    expect(
      centroid([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]),
    ).toEqual({ x: 1, y: 0 });
  });
});

describe("mapBetweenPhotos", () => {
  const portrait = { width: 300, height: 400 };
  const landscape = { width: 400, height: 300 };
  const framing: Similarity = { tx: 0.1, ty: -0.05, rotation: 0.3, scale: 1.2 };
  const points: Point[] = [
    { x: 0.2, y: 0.3 },
    { x: 0.9, y: 0.1 },
  ];

  test("returns the points when it maps a photo onto itself", () => {
    expectPoints(
      mapBetweenPhotos(points, portrait, framing, portrait, framing),
      points,
    );
  });
  test("maps back to the start after a there-and-back trip", () => {
    const other: Similarity = {
      tx: -0.2,
      ty: 0.15,
      rotation: -1.1,
      scale: 0.7,
    };
    const there = mapBetweenPhotos(points, portrait, framing, landscape, other);
    expectPoints(
      mapBetweenPhotos(there, landscape, other, portrait, framing),
      points,
    );
  });
  test("follows a photo turned 90 degrees when a framing turns it back", () => {
    // `landscape` is `portrait` turned 90 degrees clockwise, so the top left
    // corner of the portrait photo sits at the top right of the landscape one,
    // and a point (x, y) lands at (1 - y, x). A quarter turn back undoes it.
    const turnBack: Similarity = {
      tx: 0,
      ty: 0,
      rotation: -Math.PI / 2,
      scale: 1,
    };
    const onLandscape = (p: Point) =>
      mapBetweenPhotos([p], portrait, IDENTITY, landscape, turnBack);
    expectPoints(onLandscape({ x: 0.2, y: 0.1 }), [{ x: 0.9, y: 0.2 }]);
    expectPoints(onLandscape({ x: 0, y: 0 }), [{ x: 1, y: 0 }]);
  });
});

describe("photoToGuide", () => {
  const portrait = { width: 300, height: 400 };
  test("an unframed photo's centre and top edge, on its guide", () => {
    // Unframed, a portrait photo is contained in the guide: 0.75 wide, 1 tall.
    expectPoints(
      photoToGuide(
        [
          { x: 0.5, y: 0.5 },
          { x: 0, y: 0 },
        ],
        portrait,
        IDENTITY,
      ),
      [
        { x: 0, y: 0 },
        { x: -0.375, y: -0.5 },
      ],
    );
  });
  test("two lined-up photos put the same spot at the same guide point", () => {
    const landscape = { width: 400, height: 300 };
    const framing: Similarity = { tx: 0.1, ty: -0.05, rotation: 0.3, scale: 1.2 };
    const other: Similarity = { tx: -0.2, ty: 0.15, rotation: -1.1, scale: 0.7 };
    const spot: Point[] = [{ x: 0.3, y: 0.6 }];
    const there = mapBetweenPhotos(spot, portrait, framing, landscape, other);
    expectPoints(
      photoToGuide(there, landscape, other),
      photoToGuide(spot, portrait, framing),
    );
  });
});
