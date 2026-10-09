import { query, type Options, type SDKResultMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ScalpAnalysisSchema } from "../../../supabase/functions/_shared/analysis";
import { SYSTEM_PROMPT } from "../../../supabase/functions/_shared/assessment-prompt";
import { anthropicContent, type Provider } from "./types";

const TIMEOUT_MS = 180_000;
// Structured output is returned through an end-turn tool call, so one turn should
// suffice. If a live run ends with error_max_turns, raise this and record why here.
const MAX_TURNS = 1;

const OUTPUT_SCHEMA = z.toJSONSchema(ScalpAnalysisSchema, { target: "draft-7" }) as Record<string, unknown>;

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

export function createClaudeProvider(): Provider {
  return {
    async analyze(parts, { model }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let reportedModel: string | undefined;
      let final: SDKResultMessage | undefined;
      try {
        const options: Options = {
          model: model ?? "claude-haiku-5-5",
          systemPrompt: SYSTEM_PROMPT,
          outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
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
        model: reportedModel ?? Object.keys(final.modelUsage)[0] ?? model ?? "claude",
      };
    },
  };
}
