import {
  align,
  type AlignOptions,
  type GrayImage,
  type Similarity,
} from "./alignment";

/** Width / height of the capture box. Ghost and live frames are cropped to it. */
export const FRAME_ASPECT = 3 / 4;
/** Working width of the greyscale images compared on every live frame. */
export const LIVE_WIDTH = 64;

/**
 * Live framing is a small correction from an already-close position, so the
 * search is far narrower (and faster) than the full photo-to-photo alignment.
 */
export const LIVE_ALIGN: Partial<AlignOptions> = {
  maxRotationDeg: 40,
  // 1/1.15³…1.15³, so the coarse search's 1.15× scale steps land exactly on
  // 1.0×. A grid that skips 1.0× can miss a pure rotation at the coarse level.
  minScale: 1 / 1.15 ** 3,
  maxScale: 1.15 ** 3,
  maxTranslation: 0.3,
};

/** How close is close enough to fire the shutter. */
export const TOLERANCE = {
  /** Width-normalised offset. */
  offset: 0.035,
  /** |ln scale| — about ±6% size. */
  scale: 0.06,
  /** Radians — about ±4°. */
  rotation: (4 * Math.PI) / 180,
  /** Minimum edge-map correlation to trust the estimate at all. */
  minScore: 0.2,
  /**
   * Correlation needed before an auto capture. Aligned frames score ~0.85;
   * a wrong estimate pulled off by an unmatched hard edge scored ~0.45.
   */
  captureScore: 0.5,
  /** Frame brightness as a fraction of the ghost's. */
  darkest: 0.78,
  brightest: 1.3,
};

export type Hint =
  | "no-match"
  | "too-dark"
  | "too-bright"
  | "closer"
  | "farther"
  | "rotate-cw"
  | "rotate-ccw"
  | "line-up"
  | "hold";

export const HINT_TEXT: Record<Hint, string> = {
  "no-match": "Find the ghost",
  "too-dark": "Too dark",
  "too-bright": "Too bright",
  closer: "Move closer",
  farther: "Move back",
  "rotate-cw": "Turn clockwise",
  "rotate-ccw": "Turn counterclockwise",
  "line-up": "Line up the outline",
  hold: "Hold still",
};

export type Guidance = {
  /**
   * Where the ghost's content sits in the live frame, in *preview*
   * coordinates (already mirrored for a front camera). Identity when aligned.
   */
  offset: Similarity;
  /** Edge-map correlation, -1..1. */
  score: number;
  /** Live frame mean brightness / ghost mean brightness. */
  brightness: number;
  /** 0..1, how close the framing is. Drives the meter. */
  match: number;
  /** Framing, lighting and confidence are all within tolerance. */
  matched: boolean;
  hint: Hint;
};

export function meanOf(img: GrayImage): number {
  let sum = 0;
  for (let i = 0; i < img.data.length; i++) sum += img.data[i];
  return sum / Math.max(1, img.data.length);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Compare a live frame with the ghost photo and decide what the user should do.
 * Both images are unmirrored camera output; `mirrored` says whether the preview
 * the user sees is flipped (front camera), so hints and the on-screen outline
 * move the way the user expects.
 */
export function guide(
  ghost: GrayImage,
  frame: GrayImage,
  { mirrored = false, ghostMean = meanOf(ghost) } = {},
): Guidance {
  const brightness = meanOf(frame) / Math.max(ghostMean, 1e-6);
  const { transform, score } = align(ghost, frame, LIVE_ALIGN);
  const offset: Similarity = mirrored
    ? { ...transform, tx: -transform.tx, rotation: -transform.rotation }
    : transform;

  const offsetError = Math.hypot(offset.tx, offset.ty) / TOLERANCE.offset;
  const scaleError = Math.abs(Math.log(offset.scale)) / TOLERANCE.scale;
  const rotationError = Math.abs(offset.rotation) / TOLERANCE.rotation;
  const worst = Math.max(offsetError, scaleError, rotationError);
  const confident = Number.isFinite(score) && score >= TOLERANCE.minScore;
  const lit =
    brightness >= TOLERANCE.darkest && brightness <= TOLERANCE.brightest;

  // 1 inside tolerance, fading to 0 at ~5× tolerance; scaled by confidence.
  const match = confident
    ? clamp01(1 - (worst - 1) / 4) *
      clamp01(
        (score - TOLERANCE.minScore) /
          (TOLERANCE.captureScore - TOLERANCE.minScore),
      )
    : 0;
  const matched =
    confident && lit && worst <= 1 && score >= TOLERANCE.captureScore;

  let hint: Hint;
  if (!confident)
    hint = brightness < TOLERANCE.darkest ? "too-dark" : "no-match";
  else if (brightness < TOLERANCE.darkest) hint = "too-dark";
  else if (brightness > TOLERANCE.brightest) hint = "too-bright";
  else if (matched) hint = "hold";
  else if (
    scaleError >= offsetError &&
    scaleError >= rotationError &&
    scaleError > 1
  )
    // Ghost content looks bigger than it should: the camera is too close.
    hint = offset.scale > 1 ? "farther" : "closer";
  else if (rotationError >= offsetError && rotationError > 1)
    // Content turned clockwise on screen; turning the phone clockwise undoes it.
    hint = offset.rotation > 0 ? "rotate-cw" : "rotate-ccw";
  else hint = "line-up";

  return {
    offset,
    score,
    brightness,
    match: matched ? 1 : Math.min(match, 0.95),
    matched,
    hint,
  };
}
