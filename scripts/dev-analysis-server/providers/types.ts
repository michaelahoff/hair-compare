import type Anthropic from "@anthropic-ai/sdk";
import type { AssessmentPart } from "../../../supabase/functions/_shared/assessment-prompt";

export type Provider = {
  analyze(parts: AssessmentPart[], options: { model?: string }): Promise<{ result: unknown; model: string }>;
};

/** The shared message parts as Anthropic Messages API content blocks. */
export function anthropicContent(parts: AssessmentPart[]): Anthropic.ContentBlockParam[] {
  return parts.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image", source: { type: "base64", media_type: part.media_type, data: part.data } },
  );
}
