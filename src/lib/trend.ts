import { framingOf } from "./framing";
import type { Photo } from "./model";

export type Trend = "gaining" | "losing" | "stable" | "unknown";

/** Summed change within ± this reads as stable. */
export const TREND_THRESHOLD = 0.08;
/** Low-confidence pairs count for less: their change is often hair or lighting. */
export const LOW_CONFIDENCE_WEIGHT = 0.4;

export const TREND_GLYPH: Record<Trend, string> = {
  gaining: "▲",
  losing: "▼",
  stable: "–",
  unknown: "",
};

/** One consecutive pair's change-map summary. */
export type PairChange = {
  gained: number;
  lost: number;
  confidence: "low" | "ok";
};

/**
 * A region's texture trend from its consecutive pairs: the confidence-weighted
 * sum of (gained − lost). Unknown unless at least one pair is high confidence.
 */
export function regionTrend(pairs: PairChange[]): {
  trend: Trend;
  score: number;
} {
  if (!pairs.some((p) => p.confidence === "ok"))
    return { trend: "unknown", score: 0 };
  const score = pairs.reduce(
    (sum, p) =>
      sum +
      (p.confidence === "ok" ? 1 : LOW_CONFIDENCE_WEIGHT) * (p.gained - p.lost),
    0,
  );
  const trend =
    score > TREND_THRESHOLD
      ? "gaining"
      : score < -TREND_THRESHOLD
        ? "losing"
        : "stable";
  return { trend, score };
}

/** Consecutive pairs of a view's framed photos, oldest first. Unframed photos are skipped. */
export function framedPairs(timeline: Photo[]): [Photo, Photo][] {
  const framed = timeline.filter((p) => framingOf(p) !== null);
  return framed.slice(1).map((after, i) => [framed[i], after]);
}
