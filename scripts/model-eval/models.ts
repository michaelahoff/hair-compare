export type Provider = "anthropic" | "gemini" | "openrouter" | "moonshot";

export type Model = {
  id: string;
  model: string;
  provider: Provider;
  key: string;
  /** USD per million tokens. Planning estimates, not a billing guarantee. */
  inputRate: number;
  outputRate: number;
  cacheReadRate?: number;
  cacheWriteRate?: number;
  reasoning: string;
  upstream?: "deepinfra" | "novita";
  outputMode?: "schema" | "prompt";
};

export const MODELS: readonly Model[] = [
  {
    id: "ling",
    model: "inclusionai/ling-3.0-flash-vl",
    provider: "openrouter",
    key: "OPENROUTER_API_KEY",
    // DeepInfra advertises structured outputs; the cheaper Novita endpoint does not.
    inputRate: 0.06,
    outputRate: 0.18,
    cacheReadRate: 0.012,
    reasoning: "disabled",
    upstream: "deepinfra",
    outputMode: "schema",
  },
  {
    id: "gemini",
    model: "gemini-3.1-flash-lite",
    provider: "gemini",
    key: "GEMINI_API_KEY",
    inputRate: 0.25,
    outputRate: 1.5,
    cacheReadRate: 0.025,
    reasoning: "minimal",
  },
  {
    id: "haiku",
    model: "claude-haiku-4-5",
    provider: "anthropic",
    key: "ANTHROPIC_API_KEY",
    inputRate: 1,
    outputRate: 5,
    cacheReadRate: 0.1,
    cacheWriteRate: 1.25,
    reasoning: "disabled",
  },
  {
    id: "sonnet",
    model: "claude-sonnet-5-5",
    provider: "anthropic",
    key: "ANTHROPIC_API_KEY",
    inputRate: 2,
    outputRate: 10,
    cacheReadRate: 0.2,
    cacheWriteRate: 2.5,
    // Matches the deployed function's adaptive-thinking default.
    reasoning: "adaptive-default",
  },
  {
    id: "kimi",
    model: "kimi-k3",
    provider: "moonshot",
    key: "MOONSHOT_API_KEY",
    inputRate: 3,
    outputRate: 15,
    cacheReadRate: 0.3,
    reasoning: "low",
  },
];

export const OPTIONAL_MODELS: readonly Model[] = [{
  id: "ling-promo",
  model: "inclusionai/ling-3.0-flash-vl",
  provider: "openrouter",
  key: "OPENROUTER_API_KEY",
  inputRate: 0.075,
  outputRate: 0.22,
  cacheReadRate: 0.015,
  reasoning: "disabled",
  upstream: "novita",
  outputMode: "prompt",
}];

export const MAX_OUTPUT_TOKENS = 4096;
export const INPUT_TOKEN_RESERVE = 25_000;
export const REQUEST_TIMEOUT_MS = 90_000;
export const PRICE_DATE = "2026-10-02";

export function selectModels(ids: string): Model[] {
  const selected = ids === "all" ? MODELS.map((m) => m.id) : ids.split(",");
  if (!selected.length || new Set(selected).size !== selected.length)
    throw new Error("Select distinct model aliases or all.");
  return selected.map((id) => {
    const model = [...MODELS, ...OPTIONAL_MODELS].find((m) => m.id === id);
    if (!model) throw new Error(`Unknown model alias: ${id}`);
    return model;
  });
}

export function reserveCost(model: Model): number {
  return (
    (INPUT_TOKEN_RESERVE * model.inputRate +
      MAX_OUTPUT_TOKENS * model.outputRate) /
    1_000_000
  );
}
