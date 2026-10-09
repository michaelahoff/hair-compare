/**
 * The picture of a head that each view's photos are lined up against, on a
 * 100 × 100 square with the front of the head (or, for face views, the top
 * of the head) at the top, before the view's turn is applied.
 *
 * Landmarks keep the places the earlier line-drawing guides gave them (the
 * top view's vertex at (50, 54), the crown's whorl at (50, 52)), so photos
 * lined up against those still sit on these.
 *
 * Pure data with no React or Expo imports, so it runs under `bun test`.
 */
import {
  IDENTITY,
  invertSimilarity,
  type Similarity,
} from "./alignment/transform";
import type { ScalpArea, ScalpView } from "./model";

/** A whole head, or a close-up of the whorl for photos that fill the frame with hair. */
export type GuideStyle = "head" | "closeup";

export type GuideArt = {
  /** The head's outline, filled faintly so the head reads as a shape. */
  silhouette: string | null;
  /** Hair as fine strands following how it grows, one path. */
  strands: string;
  /** Outlined features: ears, hairline, brows, nose, the whorl. */
  features: { d: string; dashed?: boolean; bold?: boolean }[];
  /** Rings to put a landmark in. */
  targets: { x: number; y: number; r: number; dashed?: boolean }[];
  label?: string;
};

/** Where to look on a view, for scanning: the analysis area and its spot on the guide. */
export type InspectPoint = { area: ScalpArea; x: number; y: number };

/** A feature to pin, and where the view's picture shows it (0 to 100, unturned). */
export type PinPreset = { id: string; name: string; x: number; y: number };

/** To a tenth of a guide unit, which keeps the paths short. */
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Deterministic pseudo-random numbers, so the picture is the same every time. */
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function ellipse(cx: number, cy: number, rx: number, ry: number) {
  // Four cubic arcs; k makes each a close fit to a quarter ellipse.
  const k = 0.5523;
  const [a, b] = [rx * k, ry * k];
  return [
    `M${cx} ${cy - ry}`,
    `C${round1(cx + a)} ${cy - ry} ${cx + rx} ${round1(cy - b)} ${cx + rx} ${cy}`,
    `C${cx + rx} ${round1(cy + b)} ${round1(cx + a)} ${cy + ry} ${cx} ${cy + ry}`,
    `C${round1(cx - a)} ${cy + ry} ${cx - rx} ${round1(cy + b)} ${cx - rx} ${cy}`,
    `C${cx - rx} ${round1(cy - b)} ${round1(cx - a)} ${cy - ry} ${cx} ${cy - ry}Z`,
  ].join("");
}

/** A clockwise spiral out of (cx, cy), as hair grows from a whorl. */
function spiral(cx: number, cy: number, radius: number, turns: number) {
  const steps = Math.round(turns * 36);
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * turns * 2 * Math.PI;
    const r = 0.4 + t * radius;
    d += `${i ? "L" : "M"}${round1(cx + r * Math.cos(angle))} ${round1(cy + r * Math.sin(angle))}`;
  }
  return d;
}

type Field = (x: number, y: number) => [number, number];

/** Hair leaving a whorl: outward, swirling clockwise most strongly near it. */
function whorlField(cx: number, cy: number, swirl: number): Field {
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const k = swirl * Math.exp(-d / 14) + 0.22;
    return [dx / d - (k * dy) / d, dy / d + (k * dx) / d];
  };
}

/**
 * Strands traced along `field` from seeds scattered where `grows`, each
 * stopping at its length or where hair stops growing. One path.
 */
function strands(
  field: Field,
  grows: (x: number, y: number) => boolean,
  count: number,
  length: number,
  seed: number,
) {
  const next = random(seed);
  const step = 0.9;
  let d = "";
  let made = 0;
  for (let tries = 0; made < count && tries < count * 20; tries++) {
    let x = 2 + next() * 96;
    let y = 2 + next() * 96;
    if (!grows(x, y)) continue;
    made++;
    const steps = Math.round((length * (0.6 + next() * 0.6)) / step);
    let line = `M${round1(x)} ${round1(y)}`;
    for (let i = 0; i < steps; i++) {
      const [vx, vy] = field(x, y);
      const n = Math.hypot(vx, vy) || 1;
      x += (vx / n) * step;
      y += (vy / n) * step;
      if (!grows(x, y)) break;
      line += `L${round1(x)} ${round1(y)}`;
    }
    d += line;
  }
  return d;
}

const inEllipse =
  (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;

/** Below the curve through (x0, y0), (50, ym), (x1 = 100 - x0, y0): a hairline. */
const behindHairline = (x0: number, y0: number, ym: number) => {
  // The quadratic through those three points.
  const a = (y0 - ym) / (50 - x0) ** 2;
  return (x: number, y: number) => y > ym + a * (x - 50) ** 2;
};

/** The path flipped left to right. Handles M, L, C, Q and H, as drawn here. */
const mirror = (d: string) =>
  d
    .replace(
      /([MLCQ ])(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g,
      (_m, cmd, x, y) => `${cmd}${round1(100 - Number(x))} ${y}`,
    )
    .replace(/H(-?\d+(?:\.\d+)?)/g, (_m, x) => `H${round1(100 - Number(x))}`);

function top(): GuideArt {
  const head = inEllipse(50, 54, 35, 41);
  const hairline = behindHairline(26, 28, 19);
  const leftEar = "M14.6 47C9.4 46.6 8.6 59 13.6 63.4";
  const leftEarInner = "M13.4 50.6C11.4 51.8 11.6 57 13.4 59.2";
  return {
    silhouette: ellipse(50, 54, 36, 42),
    strands: strands(
      whorlField(50, 54, 2.2),
      (x, y) => head(x, y) && hairline(x, y),
      260,
      11,
      7,
    ),
    features: [
      { d: leftEar },
      { d: leftEarInner },
      { d: mirror(leftEar) },
      { d: mirror(leftEarInner) },
      // The tip of the nose, just showing past the forehead.
      { d: "M46.2 12.4Q50 8.4 53.8 12.4" },
      { d: "M26 28Q50 10 74 28", bold: true },
      { d: "M50 13V98", dashed: true },
      { d: spiral(50, 54, 4.4, 2.2), bold: true },
    ],
    targets: [
      { x: 50, y: 54, r: 6 },
      { x: 50, y: 54, r: 14, dashed: true },
    ],
    label: "FRONT",
  };
}

function crown(): GuideArt {
  const head = inEllipse(50, 52, 41, 41);
  const leftEar = "M9 57.6C4 59.4 4.4 72 10 74.6";
  const leftEarInner = "M8.6 61C7.2 63 7.6 68.6 9.4 70.6";
  return {
    silhouette: ellipse(50, 52, 42, 42),
    strands: strands(whorlField(50, 52, 2.4), head, 300, 12, 11),
    features: [
      { d: leftEar },
      { d: leftEarInner },
      { d: mirror(leftEar) },
      { d: mirror(leftEarInner) },
      // The neck, below the back of the head.
      { d: "M35 92Q36.4 96 35.4 100" },
      { d: mirror("M35 92Q36.4 96 35.4 100") },
      { d: "M50 10V96", dashed: true },
      { d: "M8 52H92", dashed: true },
      { d: spiral(50, 52, 5, 2.4), bold: true },
    ],
    targets: [
      { x: 50, y: 52, r: 6 },
      { x: 50, y: 52, r: 16, dashed: true },
    ],
    label: "FRONT",
  };
}

/** A whorl filling the frame, for close-ups where no ear or outline shows. */
function closeup(): GuideArt {
  const inside = inEllipse(50, 50, 48, 48);
  return {
    silhouette: null,
    strands: strands(whorlField(50, 50, 3), inside, 420, 13, 23),
    features: [
      { d: "M50 42V7", dashed: true },
      // An arrowhead pointing to the forehead.
      { d: "M46 11.4L50 6.6L54 11.4" },
      { d: spiral(50, 50, 9, 2.6), bold: true },
    ],
    targets: [
      { x: 50, y: 50, r: 3.5 },
      { x: 50, y: 50, r: 20, dashed: true },
    ],
    label: "FRONT",
  };
}

function hairline(): GuideArt {
  // Inside the head's outline, roughly: a dome over straight sides.
  const head = (x: number, y: number) =>
    y > 6 &&
    Math.abs(x - 50) < 39 * Math.sqrt(1 - Math.max(0, (56 - y) / 50) ** 2);
  // Above the hairline drawn below: high in the middle, down to each sideburn.
  const above = (x: number, y: number) => {
    const dx = Math.abs(x - 50);
    return y < (dx < 16 ? 30 + 0.016 * dx * dx : 34 + (dx - 16) * 0.75);
  };
  const leftEar = "M10.2 70C5.4 70.4 5 86 9.6 90";
  return {
    silhouette:
      "M10 98C6 50 20 6 50 6C80 6 94 50 90 98Z",
    strands: strands(
      (x) => [(x - 50) * 0.018, -1],
      (x, y) => head(x, y) && above(x, y),
      220,
      12,
      31,
    ),
    features: [
      { d: "M18 46Q24 30 34 34Q50 26 66 34Q76 30 82 46", bold: true },
      { d: "M24 82Q34 75 44 80" },
      { d: "M56 80Q66 75 76 82" },
      // Upper lids, under the brows.
      { d: "M27 92Q34 88 41 92" },
      { d: "M59 92Q66 88 73 92" },
      { d: leftEar },
      { d: mirror(leftEar) },
      { d: "M50 8V98", dashed: true },
      { d: "M4 34H96", dashed: true },
    ],
    targets: [],
  };
}

/** The subject's temple from the side, front of the face to the left. */
function temple(): GuideArt {
  // Hair grows behind the hairline that sweeps back into the temple.
  const hair = (x: number, y: number) => {
    const edge =
      x < 48
        ? 30 - (x - 8) * 0.2 + ((x - 28) / 20) ** 2 * 6
        : x < 64
          ? 30 + (x - 48) * 1
          : 46 + (x - 64) * 2.6;
    return y < edge && x > 4 && x < 98 && y > 2;
  };
  return {
    silhouette: null,
    strands: strands(
      (x, y) => [1, 0.18 + (x > 62 ? 0.9 : 0) + y * 0.004],
      hair,
      190,
      12,
      43,
    ),
    features: [
      { d: "M8 30Q30 22 48 30Q60 36 64 46Q66 58 70 72", bold: true },
      { d: "M14 76Q28 68 44 74" },
      { d: "M24 86Q32 82 40 86" },
      // The ear, behind the sideburn.
      { d: "M80 64C90 62 94 76 88 90C86 94 82 94 80 90" },
      { d: "M83 70C88 70 89 79 85 84" },
      { d: "M64 4V96", dashed: true },
      { d: "M4 46H96", dashed: true },
    ],
    targets: [{ x: 64, y: 46, r: 4 }],
  };
}

const flip = (art: GuideArt): GuideArt => ({
  ...art,
  silhouette: art.silhouette && mirror(art.silhouette),
  strands: mirror(art.strands),
  features: art.features.map((f) => ({ ...f, d: mirror(f.d) })),
  targets: art.targets.map((t) => ({ ...t, x: 100 - t.x })),
});
const flipPoints = <T extends { x: number }>(points: T[]) =>
  points.map((p) => ({ ...p, x: 100 - p.x }));

/** The views a close-up of the whorl makes sense for. */
export const CLOSEUP_VIEWS: readonly ScalpView[] = ["top", "crown"];

/** How much closer the close-up picture is than the whole head. */
const CLOSEUP_ZOOM = 2.5;
/** The whorl on each whole-head picture (0 to 100), which the close-up centres on. */
const WHORL: Partial<Record<ScalpView, { x: number; y: number }>> = {
  top: { x: 50, y: 54 },
  crown: { x: 50, y: 52 },
};

/**
 * How a framing moves from one of a view's pictures to the other. The close-up
 * is the whole-head picture zoomed in on its whorl, so a photo lined up on
 * either is lined up on both, and photos placed on each still line up.
 */
export function guideCarry(
  view: ScalpView,
  from: GuideStyle,
  to: GuideStyle,
): Similarity {
  const whorl = WHORL[view];
  if (from === to || !whorl) return IDENTITY;
  const zoom: Similarity = {
    scale: CLOSEUP_ZOOM,
    rotation: 0,
    tx: -CLOSEUP_ZOOM * (whorl.x / 100 - 0.5),
    ty: -CLOSEUP_ZOOM * (whorl.y / 100 - 0.5),
  };
  return to === "closeup" ? zoom : invertSimilarity(zoom);
}

/** A view's picture: its head, or the close-up of the whorl that top and crown share. */
export type GuideKey = ScalpView | "closeup";
export function guideKey(view: ScalpView, style: GuideStyle = "head"): GuideKey {
  return style === "closeup" && CLOSEUP_VIEWS.includes(view) ? "closeup" : view;
}

/** Everything about one picture: how it's drawn, and what to look for on it. */
type Picture = {
  art: () => GuideArt;
  /** What lining a photo up looks for, in words. */
  landmarks: string;
  /** Where an analysis looks, in the order a scan visits them. */
  inspect: InspectPoint[];
  /** The features worth pinning; "Spot" is anything else, like an edge or a mole. */
  pins: PinPreset[];
};

const SPOT: PinPreset = { id: "spot", name: "Spot", x: 50, y: 40 };
const leftTemple: Omit<Picture, "art"> = {
  landmarks: "your temple and sideburn",
  inspect: [
    { area: "left_temple", x: 62, y: 44 },
    { area: "frontal_hairline", x: 30, y: 28 },
    { area: "mid_scalp", x: 40, y: 14 },
  ],
  pins: [
    { id: "temple", name: "Temple", x: 64, y: 46 },
    { id: "brow", name: "Brow end", x: 44, y: 74 },
    { id: "ear", name: "Ear", x: 84, y: 72 },
    SPOT,
  ],
};

// A face view shows the subject's left temple on the right of the picture.
const PICTURES: Record<GuideKey, Picture> = {
  top: {
    art: top,
    landmarks: "the whorl, ears and hairline",
    inspect: [
      { area: "frontal_hairline", x: 50, y: 22 },
      { area: "mid_scalp", x: 50, y: 38 },
      { area: "crown", x: 50, y: 56 },
      { area: "left_temple", x: 28, y: 30 },
      { area: "right_temple", x: 72, y: 30 },
    ],
    pins: [
      { id: "whorl", name: "Whorl", x: 50, y: 54 },
      { id: "hairline", name: "Hairline", x: 50, y: 19 },
      { id: "ear-left", name: "Left ear", x: 12, y: 55 },
      { id: "ear-right", name: "Right ear", x: 88, y: 55 },
      SPOT,
    ],
  },
  crown: {
    art: crown,
    landmarks: "the whorl and the outline of your head",
    inspect: [
      { area: "crown", x: 50, y: 52 },
      { area: "mid_scalp", x: 50, y: 24 },
      { area: "crown", x: 30, y: 60 },
      { area: "crown", x: 70, y: 60 },
    ],
    pins: [
      { id: "whorl", name: "Whorl", x: 50, y: 52 },
      { id: "ear-left", name: "Left ear", x: 7, y: 66 },
      { id: "ear-right", name: "Right ear", x: 93, y: 66 },
      { id: "neck", name: "Neck", x: 50, y: 94 },
      SPOT,
    ],
  },
  closeup: {
    art: closeup,
    landmarks: "the whorl and how the hair swirls",
    inspect: [
      { area: "crown", x: 50, y: 50 },
      { area: "mid_scalp", x: 50, y: 22 },
      { area: "crown", x: 72, y: 62 },
      { area: "crown", x: 30, y: 66 },
    ],
    pins: [{ id: "whorl", name: "Whorl", x: 50, y: 50 }, SPOT],
  },
  hairline: {
    art: hairline,
    landmarks: "your hairline and brows",
    inspect: [
      { area: "frontal_hairline", x: 50, y: 31 },
      { area: "right_temple", x: 24, y: 40 },
      { area: "left_temple", x: 76, y: 40 },
      { area: "mid_scalp", x: 50, y: 16 },
    ],
    pins: [
      { id: "hairline", name: "Hairline", x: 50, y: 30 },
      { id: "corner-left", name: "Left corner", x: 22, y: 40 },
      { id: "corner-right", name: "Right corner", x: 78, y: 40 },
      { id: "brow-left", name: "Left brow", x: 34, y: 78 },
      { id: "brow-right", name: "Right brow", x: 66, y: 78 },
      SPOT,
    ],
  },
  left_temple: { art: temple, ...leftTemple },
  right_temple: {
    art: () => flip(temple()),
    landmarks: leftTemple.landmarks,
    inspect: flipPoints(leftTemple.inspect).map((p) => ({
      ...p,
      area: p.area === "left_temple" ? "right_temple" : p.area,
    })),
    pins: flipPoints(leftTemple.pins),
  },
};

const drawn = new Map<GuideKey, GuideArt>();

/** The picture to line `view`'s photos up against. */
export function guideArt(view: ScalpView, style: GuideStyle = "head"): GuideArt {
  const key = guideKey(view, style);
  let art = drawn.get(key);
  if (!art) {
    art = PICTURES[key].art();
    drawn.set(key, art);
  }
  return art;
}

/** What lining up a view's photos looks for, in words. */
export const guideLandmarks = (view: ScalpView, style: GuideStyle = "head") =>
  PICTURES[guideKey(view, style)].landmarks;

/** Where an analysis looks on a view's picture, in the order a scan visits them. */
export const inspectPoints = (view: ScalpView, style: GuideStyle = "head") =>
  PICTURES[guideKey(view, style)].inspect;

/**
 * The features worth pinning on a view's picture. A new pin starts on its
 * spot in the picture, so on a lined-up photo it is already close.
 */
export const pinPresets = (view: ScalpView, style: GuideStyle = "head") =>
  PICTURES[guideKey(view, style)].pins;
