import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const rating = z.number().int().min(0).max(2).nullable();
const ReviewSchema = z.strictObject({
  version: z.literal(1), runId: z.string(), reviewer: z.string().trim().min(1).max(100),
  records: z.array(z.strictObject({
    reportId: z.string(), evidence: rating, uncertainty: rating,
    confounds: rating, clarity: rating, regions: rating,
    critical: z.boolean(), notes: z.string().max(2000),
  })),
});
const MappingSchema = z.array(z.object({ reportId: z.string(), modelAlias: z.string() }));

export function summarizeReviews(
  runId: string,
  mapping: z.infer<typeof MappingSchema>,
  reviews: unknown[],
) {
  const byReport = new Map(mapping.map((m) => [m.reportId, m.modelAlias]));
  const votes = new Set<string>();
  const groups = new Map<string, z.infer<typeof ReviewSchema>["records"]>();
  for (const input of reviews) {
    const review = ReviewSchema.parse(input);
    if (review.runId !== runId) throw new Error("Review belongs to another run.");
    for (const record of review.records) {
      const alias = byReport.get(record.reportId);
      if (!alias) throw new Error("Review includes an unknown report ID.");
      const voteKey = `${review.reviewer}:${record.reportId}`;
      if (votes.has(voteKey)) throw new Error("Duplicate reviewer/report vote; use one final export per reviewer.");
      votes.add(voteKey);
      if (!groups.has(alias)) groups.set(alias, []);
      groups.get(alias)!.push(record);
    }
  }
  const criteria = ["evidence", "uncertainty", "confounds", "clarity", "regions"] as const;
  return [...groups].map(([modelAlias, records]) => ({
    modelAlias,
    reviewedReports: new Set(records.map((r) => r.reportId)).size,
    ratingRecords: records.length,
    criticalFlags: records.filter((r) => r.critical).length,
    criteria: Object.fromEntries(criteria.map((criterion) => {
      const values = records.map((r) => r[criterion]).filter((v): v is number => v !== null);
      return [criterion, { rated: values.length, mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }];
    })),
  }));
}

export async function scoreFiles(run: string, paths: string[]) {
  const config = JSON.parse(await readFile(`${run}/config.json`, "utf8"));
  const mapping = MappingSchema.parse(JSON.parse(await readFile(`${run}/report-mapping.json`, "utf8")));
  const reviews = [];
  for (const path of paths) reviews.push(JSON.parse(await readFile(path, "utf8")));
  const summary = summarizeReviews(config.runId, mapping, reviews);
  await writeFile(`${run}/human-review-summary.json`, JSON.stringify({ runId: config.runId, models: summary }, null, 2), { mode: 0o600 });
  console.table(summary.map((s) => ({ model: s.modelAlias, reports: s.reviewedReports, criticalFlags: s.criticalFlags, ...Object.fromEntries(Object.entries(s.criteria).map(([k, v]) => [k, v.mean])) })));
}

// Keep this module importable by unit tests without executing the CLI.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { run: { type: "string" }, reviews: { type: "string" } }, strict: true });
  if (!values.run || !values.reviews) {
    console.error("Usage: npm run eval:score -- --run .model-eval/runs/RUN --reviews .model-eval/reviewer-a.json,.model-eval/reviewer-b.json");
    process.exitCode = 1;
  } else {
    scoreFiles(resolve(values.run), values.reviews.split(",").map((p) => resolve(p))).catch((error: unknown) => {
      console.error(error instanceof Error && error.name !== "ZodError" ? error.message : "Invalid review format.");
      process.exitCode = 1;
    });
  }
}
