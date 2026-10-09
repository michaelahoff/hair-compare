import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import jpeg from "jpeg-js";
import { z } from "zod";
import {
  HAIR_LENGTHS,
  NORWOOD_STAGES,
  SCALP_VIEWS,
  type ScalpAnalysis,
} from "../../supabase/functions/_shared/analysis";

const PhotoSchema = z.strictObject({
  path: z.string().min(1),
  view: z.enum(SCALP_VIEWS),
  taken_at: z.iso.datetime({ offset: true }),
  hair_length: z.enum(HAIR_LENGTHS).nullable().default(null),
  hair_wet: z.boolean().default(false),
  notes: z.string().max(2000).nullable().default(null),
});

export const CaseSchema = z
  .strictObject({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    tags: z.array(z.string().max(80)).default([]),
    consent_confirmed: z.boolean().default(false),
    current: PhotoSchema,
    previous: PhotoSchema.optional(),
    treatments: z
      .array(
        z.strictObject({
          name: z.string().min(1).max(200),
          dosage: z.string().max(200).nullable().default(null),
          started_on: z.iso.date(),
          ended_on: z.iso.date().nullable().default(null),
        }),
      )
      .max(30)
      .default([]),
    expected: z
      .strictObject({
        usable: z.boolean().optional(),
        changes: z
          .array(
            z.enum([
              "improved",
              "stable",
              "worse",
              "uncertain",
              "no_previous",
            ]),
          )
          .min(1)
          .optional(),
        stages: z.array(z.enum([...NORWOOD_STAGES, "indeterminate"])).min(1).optional(),
        confidence: z.array(z.enum(["low", "medium", "high"])).min(1).optional(),
      })
      .optional(),
  })
  .superRefine((c, ctx) => {
    if (c.previous && c.previous.view !== c.current.view)
      ctx.addIssue({ code: "custom", message: "Photo views must match." });
    if (c.previous && Date.parse(c.previous.taken_at) >= Date.parse(c.current.taken_at))
      ctx.addIssue({ code: "custom", message: "Previous photo must be earlier." });
    for (const t of c.treatments) {
      if (t.started_on > c.current.taken_at.slice(0, 10))
        ctx.addIssue({ code: "custom", message: "Treatments must start before the current photo." });
      if (t.ended_on && t.ended_on < t.started_on)
        ctx.addIssue({ code: "custom", message: "Treatment end precedes start." });
    }
  });

export const ManifestSchema = z.strictObject({
  version: z.literal(1),
  cases: z.array(CaseSchema).min(1).max(500),
}).superRefine((m, ctx) => {
  if (new Set(m.cases.map((c) => c.id)).size !== m.cases.length)
    ctx.addIssue({ code: "custom", message: "Case IDs must be unique." });
});

export type EvalCase = z.infer<typeof CaseSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type Part =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/jpeg" };
export type PreparedCase = {
  case: EvalCase;
  parts: Part[];
  imageHashes: string[];
  imageBytes: number;
};

export async function loadManifest(path: string): Promise<EvalCase[]> {
  const file = await readFile(path, "utf8");
  if (file.length > 2_000_000) throw new Error("Manifest is too large.");
  return ManifestSchema.parse(JSON.parse(file)).cases;
}

function describePhoto(p: Photo): string {
  const parts = [
    `view: ${p.view.replace("_", " ")}`,
    `taken ${p.taken_at.slice(0, 10)}`,
  ];
  if (p.hair_length) parts.push(`hair length: ${p.hair_length}`);
  if (p.hair_wet) parts.push("hair wet");
  if (p.notes) parts.push(`user note: ${p.notes}`);
  return parts.join("; ");
}

export async function prepareCase(c: EvalCase, manifestPath: string): Promise<PreparedCase> {
  const parts: Part[] = [];
  const imageHashes: string[] = [];
  let imageBytes = 0;
  for (const [label, photo] of [["Previous", c.previous], ["Current", c.current]] as const) {
    if (!photo) continue;
    const bytes = await readFile(resolve(dirname(manifestPath), photo.path));
    if (bytes.length > 5 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
      throw new Error(`Case ${c.id}: use JPEG images under 5 MiB.`);
    // Decode with an allocation ceiling; re-encoding strips metadata consistently.
    const decoded = jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 4, maxMemoryUsageInMB: 64 });
    if (Math.max(decoded.width, decoded.height) > 1800)
      throw new Error(`Case ${c.id}: resize JPEGs to at most 1800 px before evaluation.`);
    const prepared = jpeg.encode({ width: decoded.width, height: decoded.height, data: decoded.data }, 90).data;
    imageHashes.push(createHash("sha256").update(prepared).digest("hex"));
    imageBytes += prepared.length;
    parts.push({ type: "text", text: `${label} photo — ${describePhoto(photo)}` });
    parts.push({ type: "image", data: Buffer.from(prepared).toString("base64"), mimeType: "image/jpeg" });
  }
  const treatmentLines = [...c.treatments].sort((a, b) => a.started_on.localeCompare(b.started_on)).map(
    (t) => `- ${t.name}${t.dosage ? ` (${t.dosage})` : ""}, started ${t.started_on}${t.ended_on ? `, ended ${t.ended_on}` : ""}`,
  );
  parts.push({
    type: "text",
    text: (treatmentLines.length ? `Treatments started on or before the current photo:\n${treatmentLines.join("\n")}\n\n` : "No treatments recorded.\n\n") + "Assess the current photo.",
  });
  return { case: c, parts, imageHashes, imageBytes };
}

export type Check = { name: string; passed: boolean };

/** Mechanical consistency/fixture checks; these do not establish clinical accuracy. */
export function checkAnalysis(c: EvalCase, result: ScalpAnalysis): Check[] {
  const checks: Check[] = [
    { name: "baseline_consistency", passed: c.previous ? result.change_since_previous.assessment !== "no_previous" : result.change_since_previous.assessment === "no_previous" },
    { name: "unusable_is_indeterminate", passed: result.photo_quality.usable || result.norwood_stage === "indeterminate" },
    { name: "boxes_within_image", passed: result.regions.every(({ box }) => !box || (box.x + box.width <= 1.00001 && box.y + box.height <= 1.00001)) },
    { name: "outlines_valid", passed: result.regions.every(({ outline }) => !outline || (outline.length >= 4 && outline.every(({ x, y }) => x >= 0 && x <= 1 && y >= 0 && y <= 1))) },
  ];
  const expected = c.expected;
  if (expected?.usable !== undefined) checks.push({ name: "expected_usable", passed: expected.usable === result.photo_quality.usable });
  if (expected?.changes) checks.push({ name: "expected_change", passed: expected.changes.includes(result.change_since_previous.assessment) });
  if (expected?.stages) checks.push({ name: "expected_stage", passed: expected.stages.includes(result.norwood_stage) });
  if (expected?.confidence) checks.push({ name: "expected_confidence", passed: expected.confidence.includes(result.confidence) });
  return checks;
}
