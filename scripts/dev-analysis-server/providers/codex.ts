import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ScalpAnalysisSchema } from "../../../supabase/functions/_shared/analysis";
import { SYSTEM_PROMPT, type AssessmentPart } from "../../../supabase/functions/_shared/assessment-prompt";
import type { Provider } from "./types";

const TIMEOUT_MS = 180_000;
// Codex needs OpenAI strict-mode schema: every property required, no extra keys. The SDK's
// zodOutputFormat transform already produces that shape from the same Zod schema.
const OUTPUT_SCHEMA = zodOutputFormat(ScalpAnalysisSchema).schema;

/**
 * Codex takes images as files rather than message parts, so each image part becomes a
 * numbered marker in the text. The last image is the current photo, any earlier one the previous.
 */
export function buildCodexPrompt(parts: AssessmentPart[]): string {
  const imageCount = parts.filter((part) => part.type === "image").length;
  let image = 0;
  const blocks = parts.map((part) => {
    if (part.type === "text") return part.text;
    image++;
    const role = image === imageCount ? "the current photo" : "the previous photo";
    return `[Image ${image} attached: ${role} described above]`;
  });
  return [SYSTEM_PROMPT, ...blocks].join("\n\n");
}

export function createCodexProvider(): Provider {
  return {
    async analyze(parts, { model }) {
      const dir = await mkdtemp(join(tmpdir(), "dev-analysis-codex-"));
      try {
        const images: string[] = [];
        for (const part of parts) {
          if (part.type !== "image") continue;
          const file = join(dir, `photo-${images.length + 1}.jpg`);
          await writeFile(file, Buffer.from(part.data, "base64"), { mode: 0o600 });
          images.push(file);
        }
        const schemaPath = join(dir, "schema.json");
        const lastMessagePath = join(dir, "last.txt");
        await writeFile(schemaPath, JSON.stringify(OUTPUT_SCHEMA));

        // The prompt goes on stdin: a positional prompt after variadic -i could be swallowed as an image.
        const args = [
          "exec", "--ephemeral", "--json", "--skip-git-repo-check",
          "--sandbox", "read-only", "-C", dir,
          ...images.flatMap((file) => ["-i", file]),
          "--output-schema", schemaPath, "-o", lastMessagePath,
          ...(model ? ["-m", model] : []),
          "-",
        ];
        const run = await runCodex(args, buildCodexPrompt(parts), dir);
        const events = parseEvents(run.stdout);
        if (run.timedOut) throw new Error(`codex did not finish within ${TIMEOUT_MS / 1000} s.`);
        if (run.code !== 0) throw new Error(`codex exited with ${run.code}: ${tail(run.stderr) || tail(JSON.stringify(events.at(-1) ?? ""))}`);

        const text = (await readFile(lastMessagePath, "utf8").catch(() => "")).trim() || lastAgentMessage(events);
        if (!text) throw new Error("codex returned no final message.");
        let result: unknown;
        try {
          result = JSON.parse(text);
        } catch {
          throw new Error("codex's final message was not JSON.");
        }
        return { result, model: model ?? findModel(events) ?? "codex" };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

type RunResult = { stdout: string; stderr: string; code: number | null; timedOut: boolean };

function runCodex(args: string[], input: string, cwd: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    // A child that exits early makes stdin.end() fail with EPIPE; the close handler reports it.
    child.stdin.on("error", () => {});
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(error.code === "ENOENT" ? new Error("The codex CLI was not found on PATH.") : error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
    child.stdin.end(input);
  });
}

type Event = Record<string, unknown>;

function parseEvents(stdout: string): Event[] {
  return stdout.split("\n").flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line);
      return value && typeof value === "object" ? [value as Event] : [];
    } catch {
      return [];
    }
  });
}

// Fallback when -o did not write the file: the last agent message in the JSONL stream.
function lastAgentMessage(events: Event[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const item = events[i].item as { type?: unknown; text?: unknown } | undefined;
    if (item?.type === "agent_message" && typeof item.text === "string") return item.text;
  }
  return "";
}

function findModel(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== "object" || depth > 3) return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (key === "model" && typeof child === "string" && child) return child;
    const found = findModel(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function tail(text: string): string {
  return text.trim().slice(-300);
}
