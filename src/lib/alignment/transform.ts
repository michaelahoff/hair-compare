/**
 * A similarity transform (uniform scale, rotation, translation) in
 * width-normalised, centre-origin coordinates: a pixel (x, y) in an image of
 * width w and height h has normalised coordinates
 *   u = (x - (w - 1) / 2) / w,  v = (y - (h - 1) / 2) / w.
 *
 * An alignment maps a point in the *reference* (baseline) photo to the matching
 * point in the *target* photo: q = scale * R(rotation) * p + (tx, ty).
 * Working in normalised units makes the transform independent of the
 * resolution it was estimated at.
 */
export type Similarity = {
  tx: number;
  ty: number;
  /** Radians, clockwise on screen (y points down). */
  rotation: number;
  scale: number;
};

export const IDENTITY: Similarity = { tx: 0, ty: 0, rotation: 0, scale: 1 };

export function applySimilarity(t: Similarity, u: number, v: number): [number, number] {
  const c = Math.cos(t.rotation) * t.scale;
  const s = Math.sin(t.rotation) * t.scale;
  return [c * u - s * v + t.tx, s * u + c * v + t.ty];
}

export function invertSimilarity(t: Similarity): Similarity {
  const scale = 1 / t.scale;
  const rotation = -t.rotation;
  const c = Math.cos(rotation) * scale;
  const s = Math.sin(rotation) * scale;
  return { scale, rotation, tx: -(c * t.tx - s * t.ty), ty: -(s * t.tx + c * t.ty) };
}

export type ViewTransform = (
  | { translateX: number }
  | { translateY: number }
  | { rotate: string }
  | { scale: number }
)[];

/**
 * React Native `transform` that draws the target photo in the reference
 * photo's frame. The target image must be rendered at `boxWidth` wide (its own
 * aspect ratio) and centred on the reference box, since RN transforms pivot
 * around the view centre.
 */
export function displayTransform(alignment: Similarity, boxWidth: number): ViewTransform {
  const inv = invertSimilarity(alignment);
  // CSS/RN order: the rightmost transform is applied to the point first.
  return [
    { translateX: inv.tx * boxWidth },
    { translateY: inv.ty * boxWidth },
    { rotate: `${(inv.rotation * 180) / Math.PI}deg` },
    { scale: inv.scale },
  ];
}
