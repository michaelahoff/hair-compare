import { describe, expect, test } from "bun:test";
import { contextLines, firstSentence, matchLines, resultLines } from "./scan-script";
import type { Photo, ScalpAnalysis } from "./model";

function photo(id: string, taken_at: string, extra: Partial<Photo> = {}): Photo {
  return {
    id,
    user_id: "local",
    view: "top",
    taken_at,
    storage_path: `local/${id}.jpg`,
    width: 600,
    height: 800,
    hair_length: "short",
    hair_wet: false,
    notes: null,
    alignment: null,
    created_at: taken_at,
    uri: "",
    ...extra,
  };
}

describe("firstSentence", () => {
  test("keeps the first sentence", () => {
    expect(firstSentence("Thinner at the crown. More scalp shows.")).toBe(
      "Thinner at the crown.",
    );
  });
  test("cuts a long sentence with an ellipsis", () => {
    const line = firstSentence("a".repeat(300), 20);
    expect(line).toHaveLength(20);
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("matchLines", () => {
  test("names the photo being matched to, or Claude", () => {
    expect(matchLines("top", "head", "Jun 1", false).join(" ")).toContain(
      "Comparing with Jun 1",
    );
    expect(matchLines("crown", "closeup", null, true)[0]).toContain("Claude");
    expect(matchLines("crown", "closeup", null, false)[0]).toContain("swirl");
  });
});

describe("contextLines", () => {
  const before = photo("b", "2026-06-01T12:00:00.000Z", { hair_wet: true });
  const after = photo("a", "2026-09-01T12:00:00.000Z", { hair_length: "medium" });

  test("tells the gap, the conditions and the treatments in between", () => {
    const text = contextLines({
      before,
      after,
      treatments: [
        { name: "Minoxidil", started_on: "2026-07-01", ended_on: null },
        { name: "Old", started_on: "2025-01-01", ended_on: "2025-02-01" },
      ],
      texture: { gained: 0, lost: 0.17 },
    }).map((l) => l.text);
    expect(text[0]).toContain("92 days apart");
    expect(text.some((t) => t.includes("wet"))).toBe(true);
    expect(text.some((t) => t.includes("short to medium"))).toBe(true);
    expect(text).toContain("Minoxidil ran for 62 of those days.");
    expect(text.some((t) => t.startsWith("Old"))).toBe(false);
    expect(text.some((t) => t.includes("17% of the scalp shows less texture"))).toBe(true);
    expect(text.at(-1)).toContain("Claude");
  });
});

describe("resultLines", () => {
  const result: ScalpAnalysis = {
    photo_quality: { usable: true, issues: [] },
    norwood_stage: "3",
    confidence: "medium",
    regions: [
      {
        area: "crown",
        severity: "mild",
        observation: "Some scalp shows. More than before.",
        box: { x: 0.3, y: 0.3, width: 0.3, height: 0.3 },
        outline: null,
      },
      {
        area: "frontal_hairline",
        severity: "none",
        observation: "Not in view.",
        box: null,
        outline: null,
      },
    ],
    hair_length_effect: "",
    change_since_previous: { assessment: "stable", explanation: "Similar density. Lighting differs." },
    summary: "Mostly stable. Keep taking photos.",
  };

  test("reads the verdict, each visible region and the summary, a sentence each", () => {
    expect(resultLines(result)).toEqual([
      { text: "Looks about the same. Similar density." },
      { text: "Crown, mild: Some scalp shows.", area: "crown" },
      { text: "Mostly stable." },
    ]);
  });
});
