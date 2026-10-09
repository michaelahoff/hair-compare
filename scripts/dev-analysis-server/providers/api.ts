import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ScalpAnalysisSchema } from "../../../supabase/functions/_shared/analysis";
import { SYSTEM_PROMPT } from "../../../supabase/functions/_shared/assessment-prompt";
import { anthropicContent, type Provider } from "./types";

// The same call as the analyze-photo edge function, for parity checks with a real key.
export function createApiProvider(): Provider {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("--provider api needs ANTHROPIC_API_KEY in the environment.");
  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 0 });

  return {
    async analyze(parts, { model }) {
      const response = await client.messages.parse({
        model: model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
        max_tokens: 4096,
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: anthropicContent(parts) }],
        output_config: { format: zodOutputFormat(ScalpAnalysisSchema) },
      });
      if (response.stop_reason === "refusal") throw new Error("The model declined to analyse this photo.");
      if (!response.parsed_output)
        throw new Error(`Analysis returned an unexpected format (stop_reason ${response.stop_reason}).`);
      return { result: response.parsed_output, model: response.model };
    },
  };
}
