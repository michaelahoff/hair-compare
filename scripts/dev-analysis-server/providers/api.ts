import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { ScalpAnalysisSchema } from "../../../supabase/functions/_shared/analysis";
import { SYSTEM_PROMPT, type AssessmentPart } from "../../../supabase/functions/_shared/assessment-prompt";
import { PHOTO_MATCH_PROMPT, PhotoMatchSchema } from "../../../supabase/functions/_shared/photo-match";
import { MATCH_MODEL, anthropicContent, type Provider } from "./types";

// The same call as the analyze-photo edge function, for parity checks with a real key.
export function createApiProvider(): Provider {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("--provider api needs ANTHROPIC_API_KEY in the environment.");
  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 0 });

  async function structured<T>(parts: AssessmentPart[], system: string, schema: z.ZodType<T>, model: string) {
    const response = await client.messages.parse({
      model,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: anthropicContent(parts) }],
      output_config: { format: zodOutputFormat(schema) },
    });
    if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
    if (!response.parsed_output)
      throw new Error(`The model returned an unexpected format (stop_reason ${response.stop_reason}).`);
    return { result: response.parsed_output, model: response.model };
  }

  return {
    analyze: (parts, { model }) =>
      structured(parts, SYSTEM_PROMPT, ScalpAnalysisSchema, model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5"),
    match: (parts, { model }) => structured(parts, PHOTO_MATCH_PROMPT, PhotoMatchSchema, model ?? MATCH_MODEL),
  };
}
