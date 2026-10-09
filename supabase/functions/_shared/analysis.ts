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
export type ScalpArea = (typeof SCALP_AREAS)[number];

export const SEVERITIES = ["none", "mild", "moderate", "severe"] as const;
export type Severity = (typeof SEVERITIES)[number];

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

const OutlinePointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

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
      severity: z.enum(SEVERITIES),
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
      /**
       * Polygon tracing the region: 4 to 12 points, clockwise, fractions of image
       * width/height; null if not visible. The point count is not enforced here, so
       * a wrong count does not discard the whole assessment; the eval scorer measures
       * compliance and the app ignores outlines under 3 points. Defaults to null so
       * analyses stored before scalp-v2 still parse.
       */
      outline: z.array(OutlinePointSchema).nullable().default(null),
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

/**
 * Copy of the result where each region with a usable outline (3+ points) gets
 * `box` set to the outline's bounds, so clients that only read `box` keep working.
 */
export function withOutlineBoxes(result: ScalpAnalysis): ScalpAnalysis {
  return {
    ...result,
    regions: result.regions.map((region) => {
      if (!region.outline || region.outline.length < 3) return region;
      const xs = region.outline.map((p) => p.x);
      const ys = region.outline.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return {
        ...region,
        box: { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY },
      };
    }),
  };
}

/** A photo as sent for assessment: the image plus the capture conditions the model is told about. */
export const AssessmentPhotoSchema = z.object({
  base64: z.string().min(1),
  media_type: z.literal("image/jpeg"),
  view: z.enum(SCALP_VIEWS),
  taken_at: z.string().min(10),
  hair_length: z.enum(HAIR_LENGTHS).nullable(),
  hair_wet: z.boolean(),
  notes: z.string().nullable(),
});
export type AssessmentPhoto = z.infer<typeof AssessmentPhotoSchema>;

/**
 * Body the app posts to the developer analysis server's `/analyze`. The edge
 * function resolves the same inputs from the database itself.
 */
export const AssessmentRequestSchema = z.object({
  photo: AssessmentPhotoSchema,
  previous: AssessmentPhotoSchema.nullable(),
  treatments: z.array(
    z.object({
      name: z.string(),
      dosage: z.string().nullable(),
      started_on: z.string(),
      ended_on: z.string().nullable(),
    }),
  ),
});
export type AssessmentRequest = z.infer<typeof AssessmentRequestSchema>;
