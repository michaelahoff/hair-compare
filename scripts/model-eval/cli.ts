import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ASSESSMENT_PROMPT_VERSION, SYSTEM_PROMPT } from "../../supabase/functions/_shared/assessment-prompt";
import { WIRE_SCHEMA } from "./adapters";
import { loadManifest, prepareCase, type PreparedCase } from "./cases";
import { MAX_OUTPUT_TOKENS, MODELS, OPTIONAL_MODELS, PRICE_DATE, selectModels } from "./models";
import { renderReview } from "./review";
import { digest, plannedReserve, preflight, runEvaluation, summarize, type RecordRow } from "./run";

async function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" }, models: { type: "string", default: "all" },
      case: { type: "string" }, repeat: { type: "string", default: "1" },
      live: { type: "boolean", default: false }, "max-usd": { type: "string", default: "0" },
      env: { type: "string" }, list: { type: "boolean" }, help: { type: "boolean", short: "h" },
    },
    strict: true, allowPositionals: false,
  });
  if (values.help) {
    console.log("Usage: npm run eval:models -- --manifest .model-eval/smoke/manifest.json [--models all|ling,gemini,haiku,sonnet,kimi] [--case ID,ID] [--repeat 1..10] [--env .env.models.local] [--live --max-usd 2]\nWithout --live: validates inputs and prints a plan; no network requests.\n--list: show model aliases. See docs/model-evaluation.md.");
    return;
  }
  if (values.list) {
    console.table([...MODELS, ...OPTIONAL_MODELS].map(({ id, model, provider, key, reasoning, upstream, outputMode }) => ({ id, model, provider, key, reasoning, upstream, outputMode: outputMode ?? "schema" })));
    return;
  }
  if (!values.manifest) throw new Error("Supply --manifest or use --help.");
  if (values.env) loadEnvFile(resolve(values.env));
  const manifestPath = resolve(values.manifest);
  const allCases = await loadManifest(manifestPath);
  const selectedIds = values.case?.split(",");
  if (selectedIds && selectedIds.some((id) => !allCases.some((c) => c.id === id)))
    throw new Error("A selected --case ID is missing from the manifest.");
  const cases: PreparedCase[] = [];
  // Validate and prepare every selected image before any paid call.
  for (const c of allCases.filter((c) => !selectedIds || selectedIds.includes(c.id)))
    cases.push(await prepareCase(c, manifestPath));
  const models = selectModels(values.models);
  const options = { live: values.live, repeats: Number(values.repeat), maxUsd: Number(values["max-usd"]), seed: new Date().toISOString() };
  preflight(cases, models, options, process.env);
  const plan = {
    mode: values.live ? "LIVE" : "DRY RUN — no requests",
    cases: cases.map((c) => ({ id: c.case.id, images: c.imageHashes.length, preparedBytes: c.imageBytes, consentConfirmed: c.case.consent_confirmed })),
    models: models.map((m) => ({ alias: m.id, model: m.model, provider: m.provider, keyVariable: m.key, keyPresent: !!process.env[m.key]?.trim(), upstream: m.upstream ?? null, reasoning: m.reasoning, outputMode: m.outputMode ?? "schema" })),
    requests: cases.length * models.length * options.repeats,
    planningReserveUsd: plannedReserve(cases, models, options.repeats),
    maxUsd: options.maxUsd,
  };
  console.log(JSON.stringify(plan, null, 2));
  if (!values.live) return;
  const root = resolve(".model-eval/runs");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const output = await mkdtemp(`${root}/${options.seed.replace(/[:.]/g, "-")}-`);
  await mkdir(`${output}/assets`, { mode: 0o700 });
  for (const c of cases) {
    let i = 0;
    for (const part of c.parts) if (part.type === "image") {
      await writeFile(`${output}/assets/${c.imageHashes[i++]}.jpg`, Buffer.from(part.data, "base64"), { mode: 0o600 });
    }
  }
  const config = {
    version: 1, runId: options.seed, promptVersion: ASSESSMENT_PROMPT_VERSION,
    promptHash: digest(SYSTEM_PROMPT), schemaHash: digest(JSON.stringify(WIRE_SCHEMA)),
    manifestHash: digest(await readFile(manifestPath, "utf8")),
    adapterHash: digest(await readFile(new URL("./adapters.ts", import.meta.url), "utf8")),
    jpegPreparation: "jpeg-js decode; <=1800px; metadata removed; quality90",
    maxOutputTokens: MAX_OUTPUT_TOKENS, priceDate: PRICE_DATE,
    models, options, plan,
  };
  await writeFile(`${output}/config.json`, JSON.stringify(config, null, 2), { mode: 0o600 });
  const rows: RecordRow[] = [];
  let runError: string | null = null;
  try {
    await runEvaluation(cases, models, options, process.env, async (row) => {
      await appendFile(`${output}/results.jsonl`, `${JSON.stringify(row)}\n`, { mode: 0o600 });
      rows.push(row);
      console.log(`${row.caseId} / ${row.modelAlias} / repeat ${row.repeat}: ${row.status}${row.error ? ` (${row.error})` : ""}, ${row.latencyMs}ms`);
    });
  } catch (error) {
    runError = error instanceof Error ? error.message : "Run interrupted.";
  } finally {
    const summary = summarize(rows);
    await writeFile(`${output}/summary.json`, JSON.stringify({ runError, models: summary }, null, 2), { mode: 0o600 });
    const columns = ["modelAlias", "attempts", "successful", "failures", "p50LatencyMs", "p95LatencyMs", "knownCostUsd", "unknownCostAttempts", "costPerSuccessfulAssessmentUsd", "budgetDebitUsd", "repeatedCases", "inconsistentRepeatedCases"] as const;
    await writeFile(`${output}/summary.csv`, [columns.join(","), ...summary.map((s) => columns.map((k) => s[k] ?? "").join(","))].join("\n") + "\n", { mode: 0o600 });
    await writeFile(`${output}/review.html`, renderReview(cases, rows, options.seed), { mode: 0o600 });
    await writeFile(`${output}/report-mapping.json`, JSON.stringify(rows.map(({ reportId, modelAlias, requestedModel, upstream, repeat }) => ({ reportId, modelAlias, requestedModel, upstream, repeat })), null, 2), { mode: 0o600 });
    console.log(`Results: ${output}\nOpen review.html locally for blinded scoring. Keep the directory private.`);
  }
  if (runError) throw new Error(runError);
  if (rows.some((r) => r.status === "error" || r.checks.some((c) => !c.passed))) process.exitCode = 1;
}

main().catch((error: unknown) => {
  // Avoid Zod errors that embed supplied data or dumping provider objects.
  console.error(error instanceof Error && error.name !== "ZodError" ? error.message : "Invalid manifest. Check docs/model-evaluation.md and the example.");
  process.exitCode = 1;
});
