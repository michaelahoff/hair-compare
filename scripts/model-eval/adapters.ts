import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ScalpAnalysisSchema, type ScalpAnalysis } from "../../supabase/functions/_shared/analysis";
import { SYSTEM_PROMPT } from "../../supabase/functions/_shared/assessment-prompt";
import type { Part } from "./cases";
import { MAX_OUTPUT_TOKENS, REQUEST_TIMEOUT_MS, type Model } from "./models";

// Use the production SDK's schema transformation for all providers; enforce the
// original Zod bounds locally even when a provider cannot express them natively.
export const WIRE_SCHEMA = zodOutputFormat(ScalpAnalysisSchema).schema;

export type Usage = {
  inputTokens: number | null;
  outputTokens: number | null; // Inclusive of reasoning; never add reasoning twice.
  thinkingTokens: number | null;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  providerCostUsd: number | null;
};
export type Outcome = {
  status: "ok" | "error";
  error?: "http" | "timeout" | "network" | "invalid_response" | "refusal" | "truncated" | "invalid_schema";
  httpStatus?: number;
  latencyMs: number;
  responseId: string | null;
  actualModel: string | null;
  upstream: string | null;
  finishReason: string | null;
  usage: Usage;
  costUsd: number | null;
  costSource: "provider" | "estimated" | "unknown";
  analysis?: ScalpAnalysis;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const token = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const safeId = (v: unknown): string | null => typeof v === "string" && /^[a-zA-Z0-9_.:/-]{1,200}$/.test(v) ? v : null;

export function buildRequest(model: Model, parts: Part[], apiKey: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (model.provider === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers,
      body: {
        model: model.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        ...(model.id === "sonnet" ? { thinking: { type: "adaptive" } } : {}),
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: parts.map((p) => p.type === "text" ? p : {
          type: "image", source: { type: "base64", media_type: p.mimeType, data: p.data },
        }) }],
        output_config: { format: { type: "json_schema", schema: WIRE_SCHEMA } },
      },
    };
  }
  if (model.provider === "gemini") {
    headers["x-goog-api-key"] = apiKey;
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model.model}:generateContent`,
      headers,
      body: {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: parts.map((p) => p.type === "text" ? { text: p.text } : {
          inline_data: { mime_type: p.mimeType, data: p.data },
        }) }],
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingLevel: "minimal" },
          responseFormat: { text: { mimeType: "application/json", schema: WIRE_SCHEMA } },
        },
      },
    };
  }
  headers.Authorization = `Bearer ${apiKey}`;
  const promptOnly = model.outputMode === "prompt";
  const system = promptOnly
    ? `${SYSTEM_PROMPT}\nReturn only a JSON object matching this schema, without markdown:\n${JSON.stringify(WIRE_SCHEMA)}`
    : SYSTEM_PROMPT;
  return {
    url: model.provider === "moonshot" ? "https://api.moonshot.ai/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions",
    headers,
    body: {
      model: model.model,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: parts.map((p) => p.type === "text" ? p : {
          type: "image_url", image_url: { url: `data:${p.mimeType};base64,${p.data}` },
        }) },
      ],
      ...(!promptOnly ? { response_format: { type: "json_schema", json_schema: { name: "scalp_assessment", strict: true, schema: WIRE_SCHEMA } } } : {}),
      ...(model.provider === "moonshot"
        ? { max_completion_tokens: MAX_OUTPUT_TOKENS, reasoning_effort: "low" }
        : {
          max_tokens: MAX_OUTPUT_TOKENS,
          reasoning: { enabled: false },
          provider: {
            only: [model.upstream],
            allow_fallbacks: false,
            require_parameters: true,
            data_collection: "deny",
          },
        }),
    },
  };
}

export function parseUsage(model: Model, payload: unknown): Usage {
  const p = obj(payload);
  if (model.provider === "gemini") {
    const u = obj(p.usageMetadata);
    const input = token(u.promptTokenCount);
    const total = token(u.totalTokenCount);
    const visible = token(u.candidatesTokenCount);
    const thinking = token(u.thoughtsTokenCount);
    return {
      inputTokens: input,
      outputTokens: total !== null && input !== null && total >= input ? total - input : visible !== null ? visible + (thinking ?? 0) : null,
      thinkingTokens: thinking,
      cacheReadTokens: token(u.cachedContentTokenCount) ?? 0,
      cacheWriteTokens: 0,
      providerCostUsd: null,
    };
  }
  const u = obj(p.usage);
  if (model.provider === "anthropic") {
    const cacheRead = token(u.cache_read_input_tokens) ?? 0;
    const cacheWrite = token(u.cache_creation_input_tokens) ?? 0;
    const fresh = token(u.input_tokens);
    return {
      inputTokens: fresh === null ? null : fresh + cacheRead + cacheWrite,
      outputTokens: token(u.output_tokens),
      thinkingTokens: token(obj(u.output_tokens_details).thinking_tokens),
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      providerCostUsd: null,
    };
  }
  const details = obj(u.prompt_tokens_details);
  return {
    inputTokens: token(u.prompt_tokens),
    outputTokens: token(u.completion_tokens),
    thinkingTokens: token(obj(u.completion_tokens_details).reasoning_tokens),
    cacheReadTokens: token(details.cached_tokens) ?? token(u.cached_tokens) ?? 0,
    cacheWriteTokens: token(details.cache_write_tokens) ?? 0,
    providerCostUsd: model.provider === "openrouter" ? token(u.cost) : null,
  };
}

export function estimateCost(model: Model, u: Usage): number | null {
  if (u.providerCostUsd !== null) return u.providerCostUsd;
  if (u.inputTokens === null || u.outputTokens === null) return null;
  if (u.cacheReadTokens + u.cacheWriteTokens > u.inputTokens) return null;
  if (u.cacheWriteTokens && model.cacheWriteRate === undefined) return null;
  const fresh = u.inputTokens - u.cacheReadTokens - u.cacheWriteTokens;
  return (fresh * model.inputRate + u.cacheReadTokens * (model.cacheReadRate ?? model.inputRate) + u.cacheWriteTokens * (model.cacheWriteRate ?? model.inputRate) + u.outputTokens * model.outputRate) / 1_000_000;
}

export function decodeOutcome(model: Model, payload: unknown, latencyMs: number): Outcome {
  const p = obj(payload);
  const usage = parseUsage(model, p);
  const costUsd = estimateCost(model, usage);
  const common = {
    latencyMs, usage, costUsd,
    costSource: usage.providerCostUsd !== null ? "provider" as const : costUsd !== null ? "estimated" as const : "unknown" as const,
    responseId: safeId(p.id ?? p.responseId),
    actualModel: safeId(p.model ?? p.modelVersion),
    upstream: safeId(p.provider) ?? model.upstream ?? null,
  };
  let text = "";
  let finish: string | null = null;
  let refusal = false;
  if (model.provider === "anthropic") {
    finish = safeId(p.stop_reason);
    refusal = finish === "refusal";
    text = arr(p.content).map(obj).filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
  } else if (model.provider === "gemini") {
    const candidate = obj(arr(p.candidates)[0]);
    finish = safeId(candidate.finishReason);
    refusal = !!obj(p.promptFeedback).blockReason || ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION"].includes(finish ?? "");
    text = arr(obj(candidate.content).parts).map(obj).filter((b) => !b.thought && typeof b.text === "string").map((b) => b.text).join("");
  } else {
    const choice = obj(arr(p.choices)[0]);
    const message = obj(choice.message);
    finish = safeId(choice.finish_reason);
    refusal = !!message.refusal || finish === "content_filter";
    text = typeof message.content === "string" ? message.content : "";
  }
  const base = { ...common, finishReason: finish };
  if (refusal) return { ...base, status: "error", error: "refusal" };
  if (["max_tokens", "MAX_TOKENS", "length"].includes(finish ?? ""))
    return { ...base, status: "error", error: "truncated" };
  const completed = model.provider === "anthropic" ? finish === "end_turn" : model.provider === "gemini" ? finish === "STOP" : finish === "stop";
  if (!completed || !text) return { ...base, status: "error", error: "invalid_response" };
  try {
    const analysis = ScalpAnalysisSchema.parse(JSON.parse(text));
    return { ...base, status: "ok", analysis };
  } catch {
    return { ...base, status: "error", error: "invalid_schema" };
  }
}

export async function assess(
  model: Model,
  parts: Part[],
  apiKey: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Outcome> {
  if (!apiKey.trim()) throw new Error(`Missing ${model.key}.`);
  const request = buildRequest(model, parts, apiKey);
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let httpStatus: number | undefined;
  let responseId: string | null = null;
  const failed = (error: Outcome["error"]): Outcome => ({
    status: "error", error, httpStatus, responseId,
    actualModel: null, upstream: model.upstream ?? null, finishReason: null,
    latencyMs: Math.round(performance.now() - start),
    usage: parseUsage(model, {}), costUsd: null, costSource: "unknown",
  });
  try {
    const response = await fetcher(request.url, {
      method: "POST", headers: request.headers, body: JSON.stringify(request.body),
      signal: controller.signal, redirect: "error",
    });
    httpStatus = response.status;
    responseId = safeId(response.headers.get("request-id") ?? response.headers.get("x-request-id"));
    // Never surface provider error bodies: they can echo images, notes or keys.
    if (!response.ok) return failed("http");
    let payload: unknown;
    try {
      const text = await response.text();
      if (text.length > 1_000_000) return failed("invalid_response");
      payload = JSON.parse(text);
    } catch {
      return failed(controller.signal.aborted ? "timeout" : "invalid_response");
    }
    const result = decodeOutcome(model, payload, Math.round(performance.now() - start));
    return { ...result, httpStatus, responseId: result.responseId ?? responseId };
  } catch {
    return failed(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}
