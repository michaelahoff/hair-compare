/**
 * Pins: the same feature marked on two photos of a view, such as the whorl's
 * centre or the edge of a thinning patch. Pins line the photos up with each
 * other: the after photo moves until its pins sit on the before photo's.
 *
 * Pure functions with no React or Expo imports, so they run under `bun test`.
 */
import { fitSimilarity, robustSimilarity } from "./alignment/points";
import {
  applySimilarity,
  pixelToNormal,
  type Similarity,
} from "./alignment/transform";
import { compose, type Pin } from "./framing";
import {
  guideToPhoto,
  mapBetweenPhotos,
  photoToGuide,
  type Point,
} from "./outline";

type Size = { width: number; height: number };

/** One feature, in each photo's fractions. */
export type PairPin = { id: string; name: string; before: Point; after: Point };

/** The most pins a pair keeps, so they stay easy to tell apart. */
export const MAX_PINS = 8;

/**
 * A new "Spot" pin: an id no other pin will share, and the next free number
 * `n` for its name, so removing one never leaves two pins alike.
 */
export function nextSpot(pins: { id: string; name: string }[], stamp: string) {
  const taken = pins.flatMap((p) => {
    const n = /^Spot (\d+)$/.exec(p.name)?.[1];
    return n ? [Number(n)] : [];
  });
  const n = Math.max(0, ...taken) + 1;
  return { id: `spot-${stamp}-${n}`, name: `Spot ${n}`, n };
}

/** A guide point (0 to 100 a side, unturned) in a photo's fractions. */
export function pinAt(
  x: number,
  y: number,
  photo: Size,
  framing: Similarity,
): Point {
  return guideToPhoto(
    [{ x: x / 100 - 0.5, y: y / 100 - 0.5 }],
    photo,
    framing,
  )[0];
}

/**
 * The pair's pins from what each photo has stored. A pin stored on only one
 * photo starts on the other where the framings carry it.
 */
export function pairPins(
  before: Size,
  beforeFraming: Similarity,
  beforePins: Pin[],
  after: Size,
  afterFraming: Similarity,
  afterPins: Pin[],
): PairPin[] {
  const ids = [
    ...new Set([...beforePins, ...afterPins].map((p) => p.id)),
  ].slice(0, MAX_PINS);
  return ids.map((id) => {
    const b = beforePins.find((p) => p.id === id);
    const a = afterPins.find((p) => p.id === id);
    return {
      id,
      name: (b ?? a)!.name,
      before:
        b ?? mapBetweenPhotos([a!], after, afterFraming, before, beforeFraming)[0],
      after:
        a ?? mapBetweenPhotos([b!], before, beforeFraming, after, afterFraming)[0],
    };
  });
}

/**
 * The after photo's framing that puts its pins on the before photo's. One pin
 * only shifts it; two or more also turn and scale it, as closely as they agree.
 */
export function fitToPins(
  before: Size,
  beforeFraming: Similarity,
  after: Size,
  afterFraming: Similarity,
  pins: PairPin[],
): Similarity {
  if (!pins.length) return afterFraming;
  const there = photoToGuide(
    pins.map((p) => p.before),
    before,
    beforeFraming,
  );
  const here = photoToGuide(
    pins.map((p) => p.after),
    after,
    afterFraming,
  );
  if (pins.length === 1)
    return {
      ...afterFraming,
      tx: afterFraming.tx + there[0].x - here[0].x,
      ty: afterFraming.ty + there[0].y - here[0].y,
    };
  const fit = fitSimilarity(
    here.map((h, i) => ({ a: [h.x, h.y], b: [there[i].x, there[i].y] })),
  );
  return fit ? compose(fit, afterFraming) : afterFraming;
}

/** "Top of left ear", short enough for a pin's tag. */
function pinName(feature: string) {
  const name = feature.trim().replace(/^./, (c) => c.toUpperCase());
  return name.length > 20 ? `${name.slice(0, 19).trimEnd()}…` : name;
}

/**
 * Pins from the spots a model matched in both photos, given in pixels of the
 * sizes they were sent at. Only spots that agree with the best fit are kept.
 * Their ids start with `idPrefix`: make it unique to this match, since pins
 * are paired up by id and these name nothing another pair would share.
 */
export function pinsFromMatch(
  points: { feature: string; a: Point; b: Point }[],
  sizes: { a: Size; b: Size },
  tolerance: number,
  idPrefix: string,
): PairPin[] {
  const pairs = points.map((p) => ({
    a: pixelToNormal(p.a, sizes.a),
    b: pixelToNormal(p.b, sizes.b),
  }));
  const fit = robustSimilarity(pairs, tolerance);
  if (!fit) return [];
  return points
    .filter((_, i) => {
      const [x, y] = applySimilarity(fit.transform, ...pairs[i].a);
      return Math.hypot(x - pairs[i].b[0], y - pairs[i].b[1]) < tolerance;
    })
    .slice(0, MAX_PINS)
    .map((p, i) => ({
      id: `${idPrefix}-${i + 1}`,
      name: pinName(p.feature),
      before: { x: p.a.x / sizes.a.width, y: p.a.y / sizes.a.height },
      after: { x: p.b.x / sizes.b.width, y: p.b.y / sizes.b.height },
    }));
}
