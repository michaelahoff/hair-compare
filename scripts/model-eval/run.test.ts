import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import jpeg from "jpeg-js";
import { CaseSchema, ManifestSchema, checkAnalysis, prepareCase, type PreparedCase } from "./cases";
import { assess, decodeOutcome } from "./adapters";
import { MODELS, reserveCost, selectModels } from "./models";
import { preflight, runEvaluation, summarize } from "./run";
import { renderReview } from "./review";
import { validAnalysis } from "./test-fixtures";

const evalCase = CaseSchema.parse({ id: "test", consent_confirmed: true, current: { path: "test.jpg", view: "crown", taken_at: "2026-10-02T12:00:00.000Z" }, expected: { changes: ["no_previous"] } });
const prepared: PreparedCase = { case: evalCase, parts: [{ type: "text", text: "Assess." }], imageHashes: ["abc"], imageBytes: 10 };
const options = { live: true, repeats: 1, maxUsd: 2, seed: "test-seed" };
const env = Object.fromEntries(MODELS.map((m) => [m.key, "fake"]));
const mocked: typeof assess = async (m) => decodeOutcome(m, m.provider === "anthropic"
  ? { model: m.model, stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify(validAnalysis) }] }
  : m.provider === "gemini"
    ? { modelVersion: m.model, usageMetadata: { promptTokenCount: 100, totalTokenCount: 200 }, candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(validAnalysis) }] } }] }
    : { model: m.model, usage: { prompt_tokens: 100, completion_tokens: 100 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validAnalysis) } }] }, 10);

describe("evaluation preflight and scheduling", () => {
  test("default dry run cannot call a model even with keys present", async () => {
    let calls = 0;
    const rows = await runEvaluation([prepared], [...MODELS], { ...options, live: false }, env, async () => {}, async (...args) => { calls++; return mocked(...args); });
    expect(calls).toBe(0);
    expect(rows).toEqual([]);
  });
  test("validates all keys, consent and budget before the first request", () => {
    expect(() => preflight([prepared], [...MODELS], options, {})).toThrow("Missing server-side keys");
    expect(() => preflight([{ ...prepared, case: { ...evalCase, consent_confirmed: false } }], [...MODELS], options, env)).toThrow("Confirm permission");
    expect(() => preflight([prepared], [...MODELS], { ...options, maxUsd: 0.00001 }, env)).toThrow("Planned reserve");
    expect(() => preflight([prepared], [...MODELS], { ...options, repeats: 0 }, env)).toThrow("Repeat count");
  });
  test("all models and repeats run with stable image hashes and unique blinded IDs", async () => {
    const rows = await runEvaluation([prepared], [...MODELS], { ...options, repeats: 2 }, env, async () => {}, mocked);
    expect(rows.length).toBe(10);
    expect(new Set(rows.map((r) => r.reportId)).size).toBe(10);
    expect(rows.every((r) => r.imageHashes[0] === "abc")).toBe(true);
    expect(rows.every((r) => !r.requestHash.includes("fake"))).toBe(true);
    for (const s of summarize(rows)) {
      expect(s.successful).toBe(2);
      expect(s.inconsistentRepeatedCases).toBe(0);
      expect(s.checks.expected_change.passed).toBe(2);
    }
  });
  test("stops on a failed access/rate-limit check without charging zero for unknown usage", async () => {
    const saved: number[] = [];
    const m = selectModels("sonnet");
    let calls = 0;
    await expect(runEvaluation([prepared], m, { ...options, repeats: 2 }, env, async (r) => { saved.push(r.budgetDebitUsd); }, async (model) => {
      calls++;
      return { ...decodeOutcome(model, {}, 10), error: "http", httpStatus: 429 };
    })).rejects.toThrow("Stopped after HTTP 429");
    expect(calls).toBe(1);
    expect(saved).toEqual([reserveCost(m[0])]);
  });
  test("an unexpectedly expensive call prevents scheduling past the remaining budget", async () => {
    let calls = 0;
    await expect(runEvaluation([prepared], selectModels("ling,haiku"), { ...options, maxUsd: 0.1 }, env, async () => {}, async (...args) => {
      calls++;
      return { ...await mocked(...args), costUsd: 0.099 };
    })).rejects.toThrow("Scheduling budget exhausted");
    expect(calls).toBe(1);
  });
});

describe("dataset and review handling", () => {
  test("rejects mismatched views, reversed timestamps, duplicate IDs and impossible dates", () => {
    expect(() => CaseSchema.parse({ ...evalCase, previous: { ...evalCase.current, view: "top", taken_at: "2026-09-02T12:00:00.000Z" } })).toThrow();
    expect(() => CaseSchema.parse({ ...evalCase, previous: evalCase.current })).toThrow();
    expect(() => ManifestSchema.parse({ version: 1, cases: [evalCase, evalCase] })).toThrow();
    expect(() => CaseSchema.parse({ ...evalCase, current: { ...evalCase.current, taken_at: "2026-02-30T12:00:00.000Z" } })).toThrow();
  });
  test("rejects nonscalp reports with a confident stage and boxes beyond the image", () => {
    const result = { ...validAnalysis, photo_quality: { usable: false, issues: [] }, norwood_stage: "3" as const, confidence: "high" as const, change_since_previous: { assessment: "no_previous" as const, explanation: "No baseline" }, regions: [{ area: "crown" as const, severity: "mild" as const, observation: "Visible", box: { x: 0.9, y: 0, width: 0.3, height: 0.2 }, outline: null }] };
    const checks = checkAnalysis(evalCase, result);
    expect(checks.find((c) => c.name === "unusable_is_indeterminate")?.passed).toBe(false);
    expect(checks.find((c) => c.name === "boxes_within_image")?.passed).toBe(false);
  });
  test("prepares identical JPEGs identically and excludes labels from provider parts", async () => {
    const dir = await mkdtemp(`${tmpdir()}/scalp-eval-`);
    try {
      const data = Buffer.alloc(32 * 32 * 4, 100);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      await writeFile(`${dir}/test.jpg`, jpeg.encode({ width: 32, height: 32, data }, 90).data);
      const c = CaseSchema.parse({ ...evalCase, previous: { ...evalCase.current, taken_at: "2026-09-02T12:00:00.000Z" } });
      const p = await prepareCase(c, `${dir}/manifest.json`);
      expect(p.imageHashes[0]).toBe(p.imageHashes[1]);
      expect(p.parts.filter((x) => x.type === "image").length).toBe(2);
      expect(JSON.stringify(p.parts)).not.toContain("expected");
      await writeFile(`${dir}/test.jpg`, "not-an-image SECRET");
      await expect(prepareCase(c, `${dir}/manifest.json`)).rejects.toThrow("use JPEG images");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  test("removes EXIF and comments from images sent to providers", async () => {
    const dir = await mkdtemp(`${tmpdir()}/scalp-eval-metadata-`);
    try {
      const source = { width: 32, height: 32, data: Buffer.alloc(32 * 32 * 4, 255), comments: ["PRIVATE COMMENT"], exifBuffer: Buffer.from("Exif\0\0PRIVATE GPS MARKER") };
      const original = jpeg.encode(source, 90).data;
      const originalDecoded = jpeg.decode(original);
      expect(originalDecoded.comments).toEqual(["PRIVATE COMMENT"]);
      expect(originalDecoded.exifBuffer?.length).toBeGreaterThan(0);
      await writeFile(`${dir}/test.jpg`, original);
      const p = await prepareCase(evalCase, `${dir}/manifest.json`);
      const image = p.parts.find((part) => part.type === "image");
      if (!image || image.type !== "image") throw new Error("Missing prepared image");
      const sent = Buffer.from(image.data, "base64");
      const decoded = jpeg.decode(sent);
      expect(decoded.comments).toBeUndefined();
      expect(decoded.exifBuffer).toBeUndefined();
      expect(sent.includes(Buffer.from("PRIVATE COMMENT"))).toBe(false);
      expect(sent.includes(Buffer.from("PRIVATE GPS MARKER"))).toBe(false);
      expect(decoded.width).toBe(32);
      expect(decoded.height).toBe(32);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  test("blinded review escapes script injection and omits identities, prices and gold labels", async () => {
    const rows = await runEvaluation([prepared], selectModels("sonnet"), options, env, async () => {}, mocked);
    rows[0].analysis!.summary = "</script><script>alert('bad')</script>";
    const html = renderReview([prepared], rows, "test-seed");
    expect(html).not.toContain("</script><script>alert");
    expect(html).not.toContain("claude-sonnet");
    expect(html).not.toContain("costUsd");
    expect(html).not.toContain('"expected"');
    expect(html).toContain("\\u003c/script>");
  });
});
