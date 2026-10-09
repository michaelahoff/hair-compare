import { describe, expect, test } from "bun:test";
import { framedPairs, regionTrend, TREND_THRESHOLD } from "./trend";
import type { Photo } from "./model";

const ok = (gained: number, lost: number) => ({ gained, lost, confidence: "ok" as const });
const low = (gained: number, lost: number) => ({ gained, lost, confidence: "low" as const });

describe("regionTrend", () => {
  test("classifies by the summed change against the threshold", () => {
    expect(regionTrend([ok(0.3, 0.1)]).trend).toBe("gaining");
    expect(regionTrend([ok(0.1, 0.3)]).trend).toBe("losing");
    expect(regionTrend([ok(0.05, 0.02)]).trend).toBe("stable");
  });
  test("treats exactly the threshold as stable", () => {
    expect(regionTrend([ok(TREND_THRESHOLD, 0)]).trend).toBe("stable");
    expect(regionTrend([ok(0, TREND_THRESHOLD)]).trend).toBe("stable");
    expect(regionTrend([ok(TREND_THRESHOLD + 0.001, 0)]).trend).toBe("gaining");
    expect(regionTrend([ok(0, TREND_THRESHOLD + 0.001)]).trend).toBe("losing");
  });
  test("sums changes across pairs", () => {
    const result = regionTrend([ok(0.05, 0), ok(0.05, 0)]);
    expect(result.trend).toBe("gaining");
    expect(result.score).toBeCloseTo(0.1, 9);
  });
  test("weights low-confidence pairs at 0.4", () => {
    // 0.1 from a low pair is worth 0.04: under the threshold alone.
    expect(regionTrend([ok(0, 0), low(0.1, 0)]).trend).toBe("stable");
    // 0.25 from a low pair is worth 0.1: over it.
    expect(regionTrend([ok(0, 0), low(0.25, 0)]).trend).toBe("gaining");
    // The ok pair's +0.1 and the low pair's −0.5 × 0.4 = −0.2 sum to −0.1.
    expect(regionTrend([ok(0.1, 0), low(0, 0.5)]).trend).toBe("losing");
  });
  test("is unknown when every pair is low confidence", () => {
    expect(regionTrend([low(0.5, 0), low(0, 0.5)])).toEqual({ trend: "unknown", score: 0 });
  });
  test("is unknown with no pairs", () => {
    expect(regionTrend([])).toEqual({ trend: "unknown", score: 0 });
  });
});

describe("framedPairs", () => {
  const photo = (id: string, framed: boolean) =>
    ({
      id,
      alignment: framed ? { tx: 0, ty: 0, rotation: 0, scale: 1 } : null,
    }) as Photo;

  test("pairs consecutive framed photos and skips unframed ones", () => {
    const [a, b, c, d] = [photo("a", true), photo("b", false), photo("c", true), photo("d", true)];
    const pairs = framedPairs([a, b, c, d]).map(([x, y]) => [x.id, y.id]);
    expect(pairs).toEqual([
      ["a", "c"],
      ["c", "d"],
    ]);
  });
  test("has no pairs with fewer than two framed photos", () => {
    expect(framedPairs([])).toEqual([]);
    expect(framedPairs([photo("a", true), photo("b", false)])).toEqual([]);
  });
});
