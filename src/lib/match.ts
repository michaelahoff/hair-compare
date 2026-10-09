/**
 * Lining one photo up from another: by matching their pixels on the device,
 * or by the spots the developer server's model finds in both, and which
 * lined-up photo to match from.
 */
import { requestDevMatch } from "./dev-analysis";
import { robustSimilarity } from "./alignment/points";
import { MIN_MATCH, type Similarity } from "./alignment";
import { pixelToNormal } from "./alignment/transform";
import { chainFraming, framingOf } from "./framing";
import { alignPhotos } from "./photos";
import type { Photo } from "./model";

/**
 * Frame `target` from an already-framed `reference` of the same view by
 * matching their details. Null when no trustworthy match is found; throws
 * when the photos can't be read.
 */
export async function matchFraming(
  reference: Photo,
  referenceFraming: Similarity,
  target: Photo,
): Promise<Similarity | null> {
  const result = await alignPhotos(reference.uri, target.uri);
  if (result.score < MIN_MATCH) return null;
  return chainFraming(reference, referenceFraming, target, result.transform);
}

/** Pairs must agree to within this share of the photo's width. */
export const POINT_TOLERANCE = 0.05;
/**
 * Fewest agreeing pairs, and their largest typical miss, to trust a fit that
 * is kept unseen. AI pins (see pins.ts) ask less, as they stay on screen to
 * be dragged.
 */
const MIN_POINTS = 3;
const MAX_POINT_MISS = 0.03;
/** How far the fitted turn may stray from the turn the model reported. */
const MAX_TURN_DISAGREEMENT = (30 * Math.PI) / 180;

/**
 * Frame `target` from `reference` using the spots the developer server's
 * model finds in both. Null when it finds too few, or they don't agree.
 */
export async function matchWithClaude(
  reference: Photo,
  referenceFraming: Similarity,
  target: Photo,
): Promise<Similarity | null> {
  const { result, sizes } = await requestDevMatch(reference, target);
  if (!result.same_area) return null;
  const fit = robustSimilarity(
    result.points.map((p) => ({
      a: pixelToNormal(p.a, sizes.a),
      b: pixelToNormal(p.b, sizes.b),
    })),
    POINT_TOLERANCE,
  );
  if (!fit || fit.inliers < MIN_POINTS || fit.rms > MAX_POINT_MISS) return null;
  const said = (result.rotation_deg * Math.PI) / 180;
  const turn = Math.atan2(
    Math.sin(fit.transform.rotation - said),
    Math.cos(fit.transform.rotation - said),
  );
  if (Math.abs(turn) > MAX_TURN_DISAGREEMENT) return null;
  return chainFraming(reference, referenceFraming, target, fit.transform);
}

/**
 * The photo to line `photo` up from: the nearest-dated photo of its view
 * placed by hand, else the nearest-dated matched one. Errors would compound
 * through matched ones, so hand-placed photos come first.
 */
export function referenceFor(photo: Photo, photos: Photo[]) {
  const framed = photos.filter(
    (p) => p.id !== photo.id && p.view === photo.view && framingOf(p),
  );
  const manual = framed.filter((p) => framingOf(p)?.source !== "auto");
  const at = Date.parse(photo.taken_at);
  const distance = (p: Photo) => Math.abs(Date.parse(p.taken_at) - at);
  return (manual.length ? manual : framed).reduce<Photo | undefined>(
    (best, p) => (!best || distance(p) < distance(best) ? p : best),
    undefined,
  );
}
