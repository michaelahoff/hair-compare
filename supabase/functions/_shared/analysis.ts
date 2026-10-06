// Shared between the analyze-photo edge function (Deno) and the app (Metro),
// so keep this file dependency-free apart from zod.
import { z } from "zod";

export const SCALP_VIEWS = [
  "top",
  "crown",
  "hairline",
  "left_temple",
  "right_temple",
] as const;
export type ScalpView = (typeof SCALP_VIEWS)[number];

export const HAIR_LENGTHS = ["buzzed", "short", "medium", "long"] as const;
export type HairLength = (typeof HAIR_LENGTHS)[number];

export const SCALP_AREAS = [
  "frontal_hairline",
  "left_temple",
  "right_temple",
  "mid_scalp",
  "crown",
] as const;
export const NORWOOD_STAGES = [
  "1",
  "2",
  "2A",
  "3",
  "3A",
  "3V",
  "4",
  "4A",
  "5",
  "5A",
  "6",
  "7",
] as const;
export type NorwoodStage = (typeof NORWOOD_STAGES)[number];

export const ScalpAnalysisSchema = z.object({
  photo_quality: z.object({
    usable: z.boolean(),
    issues: z.array(z.string()),
  }),
  norwood_stage: z.enum([...NORWOOD_STAGES, "indeterminate"]),
  confidence: z.enum(["low", "medium", "high"]),
  regions: z.array(
    z.object({
      area: z.enum(SCALP_AREAS),
      severity: z.enum(["none", "mild", "moderate", "severe"]),
      observation: z.string(),
      /** Approximate location as fractions (0-1) of image width/height; null if not visible. */
      box: z
        .object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().min(0).max(1),
          height: z.number().min(0).max(1),
        })
        .nullable(),
    }),
  ),
  hair_length_effect: z.string(),
  change_since_previous: z.object({
    assessment: z.enum([
      "improved",
      "stable",
      "worse",
      "uncertain",
      "no_previous",
    ]),
    explanation: z.string(),
  }),
  summary: z.string(),
});

export type ScalpAnalysis = z.infer<typeof ScalpAnalysisSchema>;

/** Numeric position on the Norwood scale for charting; sub-types sit half a step up. */
export function norwoodOrdinal(
  stage: ScalpAnalysis["norwood_stage"],
): number | null {
  if (stage === "indeterminate") return null;
  const base = Number.parseInt(stage, 10);
  return stage.length > 1 ? base + 0.5 : base;
}
