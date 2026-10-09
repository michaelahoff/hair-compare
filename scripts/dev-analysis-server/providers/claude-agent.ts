import { query, type Options, type SDKResultMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ScalpAnalysisSchema } from "../../../supabase/functions/_shared/analysis";
import { SYSTEM_PROMPT, type AssessmentPart } from "../../../supabase/functions/_shared/assessment-prompt";
import { PHOTO_MATCH_PROMPT, PhotoMatchSchema } from "../../../supabase/functions/_shared/photo-match";
import { MATCH_MODEL, anthropicContent, type Provider } from "./types";

const TIMEOUT_MS = 180_000;
// Structured output is returned through an end-turn tool call. One turn was
// expected to suffice, but a live analysis on Haiku 5.5 (2026-10-09) ended with
// error_max_turns at 1: the model can take a turn before that call. Three
// leaves room for that without letting a run wander.
const MAX_TURNS = 3;

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
const ANALYSIS_SCHEMA = jsonSchema(ScalpAnalysisSchema);
const MATCH_SCHEMA = jsonSchema(PhotoMatchSchema);

// Runs on the developer's Claude Code login. An API key in the environment (including a
// repo .env that Bun loads automatically) would bill the API instead, so it is removed.
// Session plumbing from a parent Claude Code process is removed too, so the child cannot
// attach to the session that started this server.
const STRIPPED_ENV = [
  "ANTHROPIC_API_KEY",
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_PID",
];

function subprocessEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of STRIPPED_ENV) delete env[name];
  return env;
}

async function* singleUserMessage(content: Anthropic.ContentBlockParam[]): AsyncGenerator<SDKUserMessage> {
  yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
}

/** One structured-output turn on the developer's Claude Code login. */
async function structured(
  parts: AssessmentPart[],
  { systemPrompt, schema, model }: { systemPrompt: string; schema: Record<string, unknown>; model: string },
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let reportedModel: string | undefined;
  let final: SDKResultMessage | undefined;
  try {
    const options: Options = {
      model,
      systemPrompt,
      outputFormat: { type: "json_schema", schema },
      tools: [],
      maxTurns: MAX_TURNS,
      permissionMode: "dontAsk",
      // No ~/.claude or project settings, CLAUDE.md, hooks or MCP config, and no saved session.
      settingSources: [],
      persistSession: false,
      env: subprocessEnv(),
      abortController: controller,
    };
    for await (const message of query({ prompt: singleUserMessage(anthropicContent(parts)), options })) {
      if (message.type === "system" && message.subtype === "init") reportedModel = message.model;
      if (message.type === "assistant") reportedModel ??= message.message.model;
      if (message.type === "result") final = message;
    }
  } finally {
    clearTimeout(timer);
  }

  if (!final) throw new Error("Claude Agent SDK ended without a result.");
  if (final.subtype !== "success")
    throw new Error(`Claude Agent SDK stopped with ${final.subtype}: ${final.errors.join("; ") || "no detail"}`);
  if (final.is_error || final.structured_output === undefined)
    throw new Error("Claude Agent SDK returned no structured output.");
  return {
    result: final.structured_output,
    model: reportedModel ?? Object.keys(final.modelUsage)[0] ?? model,
  };
}

export function createClaudeProvider(): Provider {
  return {
    analyze: (parts, { model }) =>
      structured(parts, { systemPrompt: SYSTEM_PROMPT, schema: ANALYSIS_SCHEMA, model: model ?? "claude-haiku-5-5" }),
    match: (parts, { model }) =>
      structured(parts, { systemPrompt: PHOTO_MATCH_PROMPT, schema: MATCH_SCHEMA, model: model ?? MATCH_MODEL }),
  };
}
