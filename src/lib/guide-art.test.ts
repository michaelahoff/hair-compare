import { describe, expect, test } from "bun:test";
import { CLOSEUP_VIEWS, guideArt, inspectPoints } from "./guide-art";
import { SCALP_VIEWS } from "./model";

describe("guideArt", () => {
  test.each(SCALP_VIEWS)("draws a picture for %s", (view) => {
    const art = guideArt(view);
    expect(art.strands.startsWith("M")).toBe(true);
    expect(art.features.length).toBeGreaterThan(2);
  });

  test("the right temple is the left temple flipped", () => {
    const left = guideArt("left_temple");
    const right = guideArt("right_temple");
    expect(right.targets).toEqual(
      left.targets.map((t) => ({ ...t, x: 100 - t.x })),
    );
    // The reference line through the temple, and the level line, flip too.
    expect(right.features.map((f) => f.d)).toContain("M36 4V96");
    expect(right.features.map((f) => f.d)).toContain("M96 46H4");
  });

  test("only top and crown have a close-up, and it centres on the whorl", () => {
    expect(guideArt("hairline", "closeup")).toBe(guideArt("hairline"));
    for (const view of CLOSEUP_VIEWS)
      expect(guideArt(view, "closeup").targets[0]).toMatchObject({ x: 50, y: 50 });
  });

  test("keeps the landmarks of the earlier guides", () => {
    expect(guideArt("top").targets[0]).toMatchObject({ x: 50, y: 54 });
    expect(guideArt("crown").targets[0]).toMatchObject({ x: 50, y: 52 });
  });
});

describe("inspectPoints", () => {
  test.each(SCALP_VIEWS)("stays on the picture for %s", (view) => {
    for (const style of ["head", "closeup"] as const)
      for (const p of inspectPoints(view, style)) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(100);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(100);
      }
  });
});
