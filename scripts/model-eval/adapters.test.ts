import { describe, expect, test } from "bun:test";
import { assess, buildRequest, decodeOutcome, estimateCost, parseUsage, WIRE_SCHEMA } from "./adapters";
import { MODELS, selectModels } from "./models";
import { SYSTEM_PROMPT } from "../../supabase/functions/_shared/assessment-prompt";

import { validAnalysis } from "./test-fixtures";

const parts = [
  { type: "text" as const, text: "Previous photo" },
  { type: "image" as const, data: "identical-image-bytes", mimeType: "image/jpeg" as const },
  { type: "text" as const, text: "Current photo" },
  { type: "image" as const, data: "current-image-bytes", mimeType: "image/jpeg" as const },
];
const model = (id: string) => selectModels(id)[0];

describe("provider request contracts", () => {
  test("every main model receives the same production prompt, image order and schema", () => {
    for (const m of MODELS) {
      const request = buildRequest(m, parts, "test-secret");
      const body = JSON.stringify(request.body);
      expect(body).toContain("identical-image-bytes");
      expect(body).toContain("current-image-bytes");
      expect(body.indexOf("identical-image-bytes")).toBeLessThan(body.indexOf("current-image-bytes"));
      expect(body).toContain(JSON.stringify(WIRE_SCHEMA));
      expect(body).toContain(JSON.stringify(SYSTEM_PROMPT).slice(1, -1));
      expect(body).not.toContain("test-secret");
      expect(request.url).not.toContain("test-secret");
    }
  });
  test("uses Anthropic auth and adaptive thinking only for Sonnet", () => {
    const sonnet = buildRequest(model("sonnet"), parts, "secret");
    expect(sonnet.headers["x-api-key"]).toBe("secret");
    expect(sonnet.body).toHaveProperty("thinking.type", "adaptive");
    expect(buildRequest(model("haiku"), parts, "secret").body).not.toHaveProperty("thinking");
  });
  test("Gemini has image parts, documented REST structured output and bounded output", () => {
    const r = buildRequest(model("gemini"), parts, "secret");
    expect(r.headers["x-goog-api-key"]).toBe("secret");
    expect(r.body).toHaveProperty("contents.0.parts.1.inline_data.data", parts[1].data);
    expect(r.body).toHaveProperty("generationConfig.responseFormat.text.mimeType", "application/json");
    expect(r.body).toHaveProperty("generationConfig.maxOutputTokens", 4096);
  });
  test("pins Ling endpoints with no silent provider fallback", () => {
    const strict = buildRequest(model("ling"), parts, "secret");
    expect(strict.body).toHaveProperty("provider.only", ["deepinfra"]);
    expect(strict.body).toHaveProperty("provider.allow_fallbacks", false);
    expect(strict.body).toHaveProperty("provider.require_parameters", true);
    expect(strict.body).toHaveProperty("response_format.json_schema.strict", true);
    const promo = buildRequest(model("ling-promo"), parts, "secret");
    expect(promo.body).toHaveProperty("provider.only", ["novita"]);
    expect(promo.body).not.toHaveProperty("response_format");
    expect(JSON.stringify(promo.body)).toContain("without markdown");
  });
  test("Kimi uses its own completion cap and reasoning control", () => {
    const r = buildRequest(model("kimi"), parts, "secret");
    expect(r.url).toBe("https://api.moonshot.ai/v1/chat/completions");
    expect(r.body).toHaveProperty("max_completion_tokens", 4096);
    expect(r.body).toHaveProperty("reasoning_effort", "low");
  });
});

describe("usage and output handling", () => {
  test("Gemini includes thinking once in output and excludes it from JSON", () => {
    const r = decodeOutcome(model("gemini"), {
      modelVersion: "gemini-3.1-flash-lite",
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 200, totalTokenCount: 1300 },
      candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "Not JSON" }, { text: JSON.stringify(validAnalysis) }] } }],
    }, 10);
    expect(r.status).toBe("ok");
    expect(r.usage.outputTokens).toBe(300);
    expect(r.costUsd).toBeCloseTo(0.0007);
  });
  test("Anthropic cache tokens are added to total input then priced by category", () => {
    const m = model("sonnet");
    const u = parseUsage(m, { usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 300, cache_creation_input_tokens: 400, output_tokens_details: { thinking_tokens: 120 } } });
    expect(u.inputTokens).toBe(800);
    expect(u.outputTokens).toBe(200);
    expect(estimateCost(m, u)).toBeCloseTo(0.00326);
  });
  test("router reported cost overrides price estimates; missing usage is unknown", () => {
    const m = model("ling");
    expect(estimateCost(m, parseUsage(m, { usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0.2 } }))).toBe(0.2);
    expect(estimateCost(m, parseUsage(m, {}))).toBeNull();
  });
  test("Kimi completion tokens already include reasoning", () => {
    const u = parseUsage(model("kimi"), { usage: { prompt_tokens: 10, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 200 } } });
    expect(u.outputTokens).toBe(300);
    expect(u.thinkingTokens).toBe(200);
  });
  test("retains usage on truncation, refusal and invalid schema", () => {
    const m = model("haiku");
    const payload = { usage: { input_tokens: 100, output_tokens: 200 }, content: [{ type: "text", text: JSON.stringify(validAnalysis) }] };
    expect(decodeOutcome(m, { ...payload, stop_reason: "max_tokens" }, 10).error).toBe("truncated");
    expect(decodeOutcome(m, { ...payload, stop_reason: "refusal" }, 10).error).toBe("refusal");
    const invalid = decodeOutcome(m, { ...payload, stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] }, 10);
    expect(invalid.error).toBe("invalid_schema");
    expect(invalid.costUsd).not.toBeNull();
  });
  test("out of bounds region values fail local validation", () => {
    const invalid = { ...validAnalysis, regions: [{ area: "crown", severity: "mild", observation: "Visible", box: { x: 2, y: 0, width: 0.1, height: 0.1 } }] };
    expect(decodeOutcome(model("ling"), { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(invalid) } }] }, 10).error).toBe("invalid_schema");
  });
});

describe("transport failures", () => {
  test("HTTP failure is attempted once and cannot expose provider body or key", async () => {
    let calls = 0;
    const r = await assess(model("sonnet"), parts, "secret-token", (async () => {
      calls++;
      return new Response("secret-token private photo notes", { status: 429 });
    }) as typeof fetch);
    expect(calls).toBe(1);
    expect(r.error).toBe("http");
    expect(r.httpStatus).toBe(429);
    expect(JSON.stringify(r)).not.toContain("secret-token");
    expect(JSON.stringify(r)).not.toContain("private photo");
    expect(r.costUsd).toBeNull();
  });
  test("timeout cancels a pending request without retry", async () => {
    const r = await assess(model("gemini"), parts, "secret", ((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("private transport details")));
    })) as typeof fetch, 5);
    expect(r.error).toBe("timeout");
  });
  test("accepts a complete mocked response for each connection", async () => {
    for (const m of MODELS) {
      const payload = m.provider === "anthropic"
        ? { stop_reason: "end_turn", model: m.model, usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify(validAnalysis) }] }
        : m.provider === "gemini"
          ? { modelVersion: m.model, usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, totalTokenCount: 200 }, candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(validAnalysis) }] } }] }
          : { model: m.model, usage: { prompt_tokens: 100, completion_tokens: 100 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validAnalysis) } }] };
      const r = await assess(m, parts, "fake", (async () => Response.json(payload)) as typeof fetch);
      expect(r.status).toBe("ok");
      expect(r.actualModel).toBe(m.model);
      expect(r.analysis?.summary).toBe(validAnalysis.summary);
    }
  });
});
