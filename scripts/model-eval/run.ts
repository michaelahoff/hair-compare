import { createHash } from "node:crypto";
import { assess, buildRequest, type Outcome } from "./adapters";
import { checkAnalysis, type Check, type PreparedCase } from "./cases";
import { reserveCost, type Model } from "./models";

export type Options = { live: boolean; repeats: number; maxUsd: number; seed: string };
export type RecordRow = Outcome & {
  reportId: string;
  caseId: string;
  tags: string[];
  modelAlias: string;
  requestedModel: string;
  provider: string;
  repeat: number;
  requestHash: string;
  imageHashes: string[];
  imageBytes: number;
  checks: Check[];
  budgetDebitUsd: number;
};

export function plannedReserve(cases: PreparedCase[], models: Model[], repeats: number): number {
  return cases.length * repeats * models.reduce((sum, m) => sum + reserveCost(m), 0);
}

export function preflight(cases: PreparedCase[], models: Model[], options: Options, env: Record<string, string | undefined>): void {
  if (!Number.isInteger(options.repeats) || options.repeats < 1 || options.repeats > 10)
    throw new Error("Repeat count must be an integer from 1 to 10.");
  if (!cases.length || !models.length) throw new Error("Select at least one case and model.");
  if (!options.live) return;
  if (!Number.isFinite(options.maxUsd) || options.maxUsd <= 0)
    throw new Error("Live runs require a positive --max-usd planning budget.");
  if (cases.some((c) => !c.case.consent_confirmed))
    throw new Error("Confirm permission to send every selected case to the selected providers (consent_confirmed).");
  const missing = [...new Set(models.filter((m) => !env[m.key]?.trim()).map((m) => m.key))];
  if (missing.length) throw new Error(`Missing server-side keys: ${missing.join(", ")}.`);
  const planned = plannedReserve(cases, models, options.repeats);
  if (planned > options.maxUsd)
    throw new Error(`Planned reserve $${planned.toFixed(4)} exceeds --max-usd. Select fewer cases/models/repeats or raise the budget.`);
}

export async function runEvaluation(
  cases: PreparedCase[],
  models: Model[],
  options: Options,
  env: Record<string, string | undefined>,
  onRecord: (row: RecordRow) => Promise<void>,
  assessment: typeof assess = assess,
): Promise<RecordRow[]> {
  preflight(cases, models, options, env);
  if (!options.live) return [];
  const rows: RecordRow[] = [];
  let spent = 0;
  for (let repeat = 1; repeat <= options.repeats; repeat++) {
    for (const [caseIndex, prepared] of cases.entries()) {
      // Rotate a seeded order to spread sequential load/time effects across models.
      const sorted = [...models].sort((a, b) => digest(options.seed + a.id).localeCompare(digest(options.seed + b.id)));
      const offset = (caseIndex + repeat - 1) % sorted.length;
      const order = [...sorted.slice(offset), ...sorted.slice(0, offset)];
      for (const model of order) {
        const reserve = reserveCost(model);
        if (spent + reserve > options.maxUsd + 1e-10)
          throw new Error("Scheduling budget exhausted. Saved results remain available; no further calls were made.");
        const response = await assessment(model, prepared.parts, env[model.key]!);
        // Missing/failed billing information is never treated as zero spend.
        const debit = response.costUsd ?? reserve;
        spent += debit;
        const row: RecordRow = {
          ...response,
          reportId: `report-${digest(`${options.seed}:${prepared.case.id}:${model.id}:${repeat}`).slice(0, 12)}`,
          caseId: prepared.case.id,
          tags: prepared.case.tags,
          modelAlias: model.id,
          requestedModel: model.model,
          provider: model.provider,
          repeat,
          requestHash: digest(JSON.stringify(buildRequest(model, prepared.parts, "").body)),
          imageHashes: prepared.imageHashes,
          imageBytes: prepared.imageBytes,
          checks: response.analysis ? checkAnalysis(prepared.case, response.analysis) : [],
          budgetDebitUsd: debit,
        };
        rows.push(row);
        // Persist each attempt before the next paid request.
        await onRecord(row);
        if (response.error === "http" && [401, 402, 403, 404, 429].includes(response.httpStatus ?? 0))
          throw new Error(`Stopped after HTTP ${response.httpStatus} from ${model.id}. Fix access, balance, availability or rate limits before another run.`);
      }
    }
  }
  return rows;
}

export function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function summarize(rows: RecordRow[]) {
  return [...new Set(rows.map((r) => r.modelAlias))].map((modelAlias) => {
    const group = rows.filter((r) => r.modelAlias === modelAlias);
    const ok = group.filter((r) => r.status === "ok");
    const latencies = group.map((r) => r.latencyMs).sort((a, b) => a - b);
    const costs = group.filter((r) => r.costUsd !== null);
    const knownCostUsd = costs.reduce((sum, r) => sum + r.costUsd!, 0);
    const checks: Record<string, { passed: number; total: number }> = {};
    for (const row of group) for (const check of row.checks) {
      checks[check.name] ??= { passed: 0, total: 0 };
      checks[check.name].total++;
      if (check.passed) checks[check.name].passed++;
    }
    let repeatedCases = 0;
    let inconsistentRepeatedCases = 0;
    for (const caseId of new Set(ok.map((r) => r.caseId))) {
      const repeated = ok.filter((r) => r.caseId === caseId);
      if (repeated.length < 2) continue;
      repeatedCases++;
      if (new Set(repeated.map((r) => `${r.analysis!.norwood_stage}:${r.analysis!.change_since_previous.assessment}`)).size > 1)
        inconsistentRepeatedCases++;
    }
    return {
      modelAlias, attempts: group.length, successful: ok.length,
      failures: group.length - ok.length,
      p50LatencyMs: latencies[Math.ceil(latencies.length * 0.5) - 1] ?? null,
      p95LatencyMs: latencies[Math.ceil(latencies.length * 0.95) - 1] ?? null,
      knownCostUsd,
      unknownCostAttempts: group.length - costs.length,
      costPerSuccessfulAssessmentUsd: costs.length === group.length && ok.length ? knownCostUsd / ok.length : null,
      budgetDebitUsd: group.reduce((sum, r) => sum + r.budgetDebitUsd, 0),
      repeatedCases, inconsistentRepeatedCases, checks,
    };
  });
}
