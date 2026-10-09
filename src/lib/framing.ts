import { IDENTITY, type Similarity } from "./alignment/transform";

/**
 * Where a photo sits on its view's guide, so every photo of a view lines up
 * with the same template rather than with one particular other photo.
 *
 * Units are the guide square: the largest square centred in whatever frame
 * shows the photo, with side 1. Unframed, a photo is drawn contained in that
 * square and centred. A framing then scales and rotates it about its centre
 * and shifts it by (tx, ty), all before the view's quarter-turn (see `turn`).
 */
export type Framing = Similarity & {
  /** "auto" when matched from another lined-up photo. */
  source?: "manual" | "auto";
  /** Features marked on the photo; pins with the same id mark the same spot. */
  pins?: Pin[];
};

/** A feature marked on a photo, e.g. the whorl's centre, in photo fractions. */
export type Pin = { id: string; name: string; x: number; y: number };

/** Stored framing, ignoring legacy pair alignments (which carry `refPhotoId`). */
export function framingOf(photo: { alignment: unknown }): Framing | null {
  const value = photo.alignment as (Framing & { refPhotoId?: string }) | null;
  if (!value || value.refPhotoId !== undefined) return null;
  return value;
}

/** A framing as text, to tell when a stored one has changed. */
export function framingKey(framing: Similarity | null) {
  return framing
    ? `${framing.tx}:${framing.ty}:${framing.rotation}:${framing.scale}`
    : "";
}

/** A photo's unframed size in guide units: contained in the unit square. */
export function baseBox(photo: { width: number; height: number }) {
  const longest = Math.max(photo.width, photo.height);
  return { width: photo.width / longest, height: photo.height / longest };
}

/** a ∘ b: apply b, then a. */
export function compose(a: Similarity, b: Similarity): Similarity {
  "worklet";
  const c = Math.cos(a.rotation) * a.scale;
  const s = Math.sin(a.rotation) * a.scale;
  return {
    scale: a.scale * b.scale,
    rotation: a.rotation + b.rotation,
    tx: c * b.tx - s * b.ty + a.tx,
    ty: s * b.tx + c * b.ty + a.ty,
  };
}
function inverse(t: Similarity): Similarity {
  const scale = 1 / t.scale;
  const c = Math.cos(-t.rotation) * scale;
  const s = Math.sin(-t.rotation) * scale;
  return {
    scale,
    rotation: -t.rotation,
    tx: -(c * t.tx - s * t.ty),
    ty: -(s * t.tx + c * t.ty),
  };
}

/**
 * Frame `target` so it lands where the matching parts of an already-framed
 * `reference` do. `registration` maps reference points to target points in
 * each image's own width units, as `align` reports.
 */
export function chainFraming(
  reference: { width: number; height: number },
  referenceFraming: Similarity,
  target: { width: number; height: number },
  registration: Similarity,
): Similarity {
  const ref = baseBox(reference).width;
  const next = baseBox(target).width;
  // Reference guide units → target guide units.
  const between: Similarity = {
    scale: (registration.scale * next) / ref,
    rotation: registration.rotation,
    tx: registration.tx * next,
    ty: registration.ty * next,
  };
  return compose(referenceFraming, inverse(between));
}

/**
 * React Native transform for a photo box drawn at its base size, centred in a
 * frame whose guide square has side `size`, turned `turn` quarter turns
 * clockwise. Runs on the UI thread while editing.
 */
export function framedTransform(
  framing: Similarity,
  turn: number,
  size: number,
) {
  "worklet";
  const angle = (turn * Math.PI) / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    { translateX: (c * framing.tx - s * framing.ty) * size },
    { translateY: (s * framing.tx + c * framing.ty) * size },
    { rotate: `${framing.rotation + angle}rad` },
    { scale: framing.scale },
  ];
}

export { IDENTITY };

/**
 * `target` as the angle nearest `current`, so an animation between them turns
 * the short way round rather than unwinding whole turns.
 */
export function nearestTurn(current: number, target: number) {
  "worklet";
  return target + Math.round((current - target) / (2 * Math.PI)) * 2 * Math.PI;
}

/** A photo fraction in guide units (centred, side 1), through its framing. */
export function photoPointToGuide(
  x: number,
  y: number,
  base: { width: number; height: number },
  framing: Similarity,
) {
  "worklet";
  const px = (x - 0.5) * base.width;
  const py = (y - 0.5) * base.height;
  const c = Math.cos(framing.rotation) * framing.scale;
  const s = Math.sin(framing.rotation) * framing.scale;
  return { x: c * px - s * py + framing.tx, y: s * px + c * py + framing.ty };
}

/**
 * Guide units to a frame's pixels: turned `turn` quarter turns, on a guide
 * square of side `size` centred in a `width` × `height` frame.
 */
export function guideToFrame(
  x: number,
  y: number,
  turn: number,
  size: number,
  width: number,
  height: number,
) {
  "worklet";
  const angle = (turn * Math.PI) / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: width / 2 + (c * x - s * y) * size,
    y: height / 2 + (s * x + c * y) * size,
  };
}

/** A movement across a frame, in pixels, as a movement in the photo's fractions. */
export function frameDeltaToPhoto(
  dx: number,
  dy: number,
  turn: number,
  size: number,
  base: { width: number; height: number },
  framing: Similarity,
) {
  "worklet";
  // Undo the guide's turn, then the framing's turn and scale.
  const angle = (-turn * Math.PI) / 2;
  const gx = (Math.cos(angle) * dx - Math.sin(angle) * dy) / size;
  const gy = (Math.sin(angle) * dx + Math.cos(angle) * dy) / size;
  const c = Math.cos(-framing.rotation) / framing.scale;
  const s = Math.sin(-framing.rotation) / framing.scale;
  return {
    x: (c * gx - s * gy) / base.width,
    y: (s * gx + c * gy) / base.height,
  };
}
