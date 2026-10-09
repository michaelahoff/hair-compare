import { describe, expect, test } from "bun:test";
import { ScalpAnalysisSchema, withOutlineBoxes, type ScalpAnalysis } from "../../supabase/functions/_shared/analysis";
import { WIRE_SCHEMA } from "./adapters";
import { CaseSchema, checkAnalysis } from "./cases";
import { validAnalysis } from "./test-fixtures";

type Region = ScalpAnalysis["regions"][number];
const region = (outline: Region["outline"], box: Region["box"] = null): Region => ({
  area: "crown", severity: "mild", observation: "Visible", box, outline,
});
const withRegions = (...regions: Region[]): ScalpAnalysis => ({ ...validAnalysis, regions });
const evalCase = CaseSchema.parse({ id: "outline-test", consent_confirmed: true, current: { path: "test.jpg", view: "crown", taken_at: "2026-10-02T12:00:00.000Z" } });
const outlineCheck = (outline: Region["outline"]) =>
  checkAnalysis(evalCase, withRegions(region(outline))).find((c) => c.name === "outlines_valid")?.passed;

const quad = [{ x: 0.2, y: 0.1 }, { x: 0.6, y: 0.15 }, { x: 0.5, y: 0.4 }, { x: 0.25, y: 0.35 }];

describe("outline schema", () => {
  test("a result stored before scalp-v2 without outline parses with outline null", () => {
    const old = { ...validAnalysis, regions: [{ area: "crown", severity: "mild", observation: "Visible", box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }] };
    const parsed = ScalpAnalysisSchema.parse(old);
    expect(parsed.regions[0].outline).toBeNull();
    expect(parsed.regions[0].box).toEqual({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 });
  });
  test("a result with an outline parses it unchanged", () => {
    const parsed = ScalpAnalysisSchema.parse(withRegions(region(quad)));
    expect(parsed.regions[0].outline).toEqual(quad);
  });
  test("points outside the image fail parsing, so the adapter reports invalid_schema", () => {
    expect(ScalpAnalysisSchema.safeParse(withRegions(region([{ x: 1.2, y: 0.1 }, ...quad.slice(1)]))).success).toBe(false);
  });
  test("wire schema requires outline on every region so strict providers always return it", () => {
    const properties = WIRE_SCHEMA.properties as Record<string, { items?: { required?: string[] } }>;
    expect(properties.regions?.items?.required).toContain("outline");
  });
});

describe("withOutlineBoxes", () => {
  test("sets box to the outline's bounds", () => {
    const [out] = withOutlineBoxes(withRegions(region(quad))).regions;
    expect(out.box?.x).toBeCloseTo(0.2);
    expect(out.box?.y).toBeCloseTo(0.1);
    expect(out.box?.width).toBeCloseTo(0.4);
    expect(out.box?.height).toBeCloseTo(0.3);
    expect(out.outline).toEqual(quad);
  });
  test("leaves regions without an outline alone and ignores outlines with fewer than 3 points", () => {
    const boxed = { x: 0.5, y: 0.5, width: 0.1, height: 0.1 };
    const plain = region(null, boxed);
    const two = region([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }], boxed);
    const result = withOutlineBoxes(withRegions(plain, two));
    expect(result.regions[0]).toEqual(plain);
    expect(result.regions[1]).toEqual(two);
  });
  test("does not mutate the input", () => {
    const input = withRegions(region(quad));
    withOutlineBoxes(input);
    expect(input.regions[0].box).toBeNull();
  });
});

describe("outlines_valid scorer", () => {
  test("passes when the outline is null", () => {
    expect(outlineCheck(null)).toBe(true);
  });
  test("fails with fewer than 4 points", () => {
    expect(outlineCheck([{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }])).toBe(false);
  });
  test("fails when any point is outside the image", () => {
    expect(outlineCheck([{ x: 0.1, y: 0.1 }, { x: 1.2, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.2 }])).toBe(false);
  });
  test("passes a valid 5-point outline, including points on the image edges", () => {
    expect(outlineCheck([{ x: 0.2, y: 0.1 }, { x: 0.6, y: 0 }, { x: 1, y: 0.3 }, { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.4 }])).toBe(true);
  });
});
