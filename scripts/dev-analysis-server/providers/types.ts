import type Anthropic from "@anthropic-ai/sdk";
import type { AssessmentPart } from "../../../supabase/functions/_shared/assessment-prompt";

/** One structured request to the provider's model. */
type ProviderCall = (parts: AssessmentPart[], options: { model?: string }) => Promise<{ result: unknown; model: string }>;

export type Provider = {
  analyze: ProviderCall;
  /** Corresponding points between two photos; absent where the provider can't do it yet. */
  match?: ProviderCall;
};

/** Photo matching needs precise pointing, so it runs on the default model unless overridden. */
export const MATCH_MODEL = "claude-opus-5-5";

/** The shared message parts as Anthropic Messages API content blocks. */
export function anthropicContent(parts: AssessmentPart[]): Anthropic.ContentBlockParam[] {
  return parts.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image", source: { type: "base64", media_type: part.media_type, data: part.data } },
  );
}
