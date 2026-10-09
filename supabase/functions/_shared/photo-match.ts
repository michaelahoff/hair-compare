// Shared between the developer analysis server and the app (Metro), so keep
// this file dependency-free apart from zod.
import { z } from "zod";
import { SCALP_VIEWS } from "./analysis";
import type { AssessmentPart } from "./assessment-prompt";

/**
 * Asks for the same physical spots in two photos of one view, so the app can
 * fit the transform between them. Benchmarked with Claude Opus 5.5 at its
 * default effort (2026-10-09): whole-head pairs at any rotation landed within
 * 2–4% of the photo's width; hair-only close-ups years apart were mostly
 * declined with no points, which the app treats as no match. That benchmark
 * listed thinning edges among the features to trust; they now come last,
 * since lining up on them hides the change the app tracks.
 */
export const PHOTO_MATCH_PROMPT = `You match points between two photos of the same person's scalp taken on different days, so an app can line the photos up. The second photo may be rotated by any angle (even upside down), zoomed in or out, or shifted. Hair may be longer, shorter or lie differently, and thinning may have spread or filled in, so rely on what stays put: the crown whorl's centre, the parting, ears, neck, moles, scars, freckles and the outline of the head. Only use points on the person's head and neck, never the room, clothes or hands, which change between photos. Use the edges of thinning or bald areas only when nothing else is visible, because they move as hair is lost or regrows and lining up on them would hide that change. Coordinates are pixels from the top-left corner of each image, x to the right and y down.`;

const MatchPhotoSchema = z.object({
  base64: z.string().min(1),
  media_type: z.literal("image/jpeg"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/** The /match request: photo A is the lined-up reference, B the one to place. */
export const PhotoMatchRequestSchema = z.object({
  view: z.enum(SCALP_VIEWS),
  a: MatchPhotoSchema,
  b: MatchPhotoSchema,
});
export type PhotoMatchRequest = z.infer<typeof PhotoMatchRequestSchema>;

const PixelSchema = z.object({ x: z.number(), y: z.number() });

export const PhotoMatchSchema = z.object({
  same_area: z
    .boolean()
    .describe("Whether the photos show an overlapping part of the head."),
  rotation_deg: z
    .number()
    .describe("How far B's content is turned clockwise relative to A, -180 to 180."),
  points: z.array(
    z.object({ feature: z.string(), a: PixelSchema, b: PixelSchema }),
  ),
});
export type PhotoMatch = z.infer<typeof PhotoMatchSchema>;

/** The user message: both photos with their pixel sizes, then the task. */
export function photoMatchParts(request: PhotoMatchRequest): AssessmentPart[] {
  const { a, b, view } = request;
  return [
    { type: "text", text: `Photo A, ${a.width}×${a.height} px:` },
    { type: "image", data: a.base64, media_type: "image/jpeg" },
    { type: "text", text: `Photo B, ${b.width}×${b.height} px:` },
    { type: "image", data: b.base64, media_type: "image/jpeg" },
    {
      type: "text",
      text: `Both are ${view.replace("_", " ")} photos. Find 6 to 10 places that are clearly the same physical spot in both photos, spread across the area they share, and give each one's pixel position in A and in B. Only include points you are confident about. If the photos don't show the same part of the head, say so and return no points.`,
    },
  ];
}
