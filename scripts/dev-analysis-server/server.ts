// Developer analysis server: the /analyze contract of the analyze-photo edge function,
// with the model call made by a local provider chosen by flag. Development only.
//
//   bun run dev:analysis -- --provider claude|codex|api [--port 8787] [--model <id>]
import { appendFile, mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AssessmentRequestSchema, ScalpAnalysisSchema, withOutlineBoxes } from "../../supabase/functions/_shared/analysis";
import { assessmentParts } from "../../supabase/functions/_shared/assessment-prompt";
import type { Provider } from "./providers/types";

const HOST = "127.0.0.1";
/** Private network origins, allowed only with --lan (e.g. Expo web opened from another device). */
const PRIVATE_ORIGIN = /^http:\/\/(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const LOG_PATH = fileURLToPath(new URL("../../.model-eval/dev-server.log", import.meta.url));
const PROVIDER_NAMES = ["claude", "codex", "api"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

// Expo web runs at localhost:8081; native apps send no Origin header at all.
const ALLOWED_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export type RequestLog = {
  provider: ProviderName;
  model: string | null;
  latencyMs: number;
  status: "ok" | "invalid_schema" | "error";
  error?: string;
};

type Outcome = {
  status: number;
  body: unknown;
  log: Omit<RequestLog, "provider" | "latencyMs">;
};

export type ServerOptions = {
  provider: Provider;
  providerName: ProviderName;
  model?: string;
  /** Serving the local network, so private-network origins are allowed too. */
  lan?: boolean;
  log: (entry: RequestLog) => Promise<void> | void;
};

export function isAllowedOrigin(origin: string, lan = false): boolean {
  return ALLOWED_ORIGIN.test(origin) || (lan && PRIVATE_ORIGIN.test(origin));
}

/** Validates the body, runs the provider, and checks its output against ScalpAnalysisSchema. */
export async function analyzeBody(text: string, provider: Provider, model: string | undefined): Promise<Outcome> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return failure(400, "Request body must be JSON.", model);
  }
  const request = AssessmentRequestSchema.safeParse(json);
  if (!request.success) return failure(400, `Invalid request: ${summarize(request.error.issues)}`, model);

  const { photo, previous, treatments } = request.data;
  const parts = assessmentParts(
    { ...photo, data: photo.base64 },
    previous && { ...previous, data: previous.base64 },
    treatments,
  );

  let output: Awaited<ReturnType<Provider["analyze"]>>;
  try {
    output = await provider.analyze(parts, { model });
  } catch (error) {
    const message = `Provider failed: ${describeError(error)}`;
    return { status: 502, body: { error: message }, log: { status: "error", model: model ?? null, error: message } };
  }

  const checked = ScalpAnalysisSchema.safeParse(output.result);
  if (!checked.success) {
    const message = `Result did not match ScalpAnalysisSchema: ${summarize(checked.error.issues)}`;
    return { status: 502, body: { error: message }, log: { status: "invalid_schema", model: output.model, error: message } };
  }
  return { status: 200, body: { result: withOutlineBoxes(checked.data), model: output.model }, log: { status: "ok", model: output.model } };
}

export function createAnalysisServer(options: ServerOptions): Server {
  return createServer(async (req, res) => {
    try {
      await route(req, res, options);
    } catch (error) {
      console.error("Unexpected analysis server error", error instanceof Error ? error.name : "unknown");
      if (!res.headersSent) sendJson(res, 500, { error: "Internal error" }, {});
    }
  });
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  { provider, providerName, model, log, lan }: ServerOptions,
): Promise<void> {
  const origin = req.headers.origin;
  if (origin !== undefined && !isAllowedOrigin(origin, lan))
    return sendJson(res, 403, { error: "Origin not allowed" }, {});
  const cors: Record<string, string> = origin === undefined
    ? { Vary: "Origin" }
    : { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  const { pathname } = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...cors,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return;
  }
  if (req.method === "GET" && pathname === "/health")
    return sendJson(res, 200, { ok: true, provider: providerName, model: model ?? null }, cors);
  if (req.method !== "POST" || pathname !== "/analyze") return sendJson(res, 404, { error: "Not found" }, cors);

  const started = performance.now();
  const body = await readBody(req);
  const outcome = body.ok
    ? await analyzeBody(body.text, provider, model)
    : failure(body.status, body.error, model);
  await log({ provider: providerName, latencyMs: Math.round(performance.now() - started), ...outcome.log });
  sendJson(res, outcome.status, outcome.body, outcome.status === 413 ? { ...cors, Connection: "close" } : cors);
}

type BodyResult = { ok: true; text: string } | { ok: false; status: 400 | 413; error: string };

// Drains the whole body before answering so clients see the 413 rather than a reset socket.
function readBody(req: IncomingMessage): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () =>
      resolve(
        size > MAX_BODY_BYTES
          ? { ok: false, status: 413, error: "Request body is larger than 25 MB." }
          : { ok: true, text: Buffer.concat(chunks).toString("utf8") },
      ),
    );
    req.on("error", () => resolve({ ok: false, status: 400, error: "Could not read the request body." }));
  });
}

function failure(status: 400 | 413, error: string, model: string | undefined): Outcome {
  return { status, body: { error }, log: { status: "error", model: model ?? null, error } };
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string>): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function summarize(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join(".") || "body"}: ${issue.message}`)
    .join("; ");
}

function describeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 300);
}

// Loaded on demand: only the claude provider needs the Agent SDK installed here.
async function createProvider(name: ProviderName): Promise<Provider> {
  if (name === "claude") return (await import("./providers/claude-agent")).createClaudeProvider();
  if (name === "codex") return (await import("./providers/codex")).createCodexProvider();
  return (await import("./providers/api")).createApiProvider();
}

// The log holds only provider, model, timing and status. Never images, notes or treatment names.
async function writeRequestLog(entry: RequestLog): Promise<void> {
  const line = { time: new Date().toISOString(), ...entry };
  await appendFile(LOG_PATH, `${JSON.stringify(line)}\n`, { mode: 0o600 }).catch((error: unknown) =>
    console.error("Could not write the dev server log", error instanceof Error ? error.name : "unknown"),
  );
  const detail = entry.error ? ` (${entry.error})` : "";
  console.log(`analysis ${entry.status} ${entry.provider} ${entry.model ?? "-"} ${entry.latencyMs} ms${detail}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      provider: { type: "string", default: "claude" },
      port: { type: "string", default: "8787" },
      model: { type: "string" },
      lan: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log("Usage: bun run dev:analysis -- [--provider claude|codex|api] [--port 8787] [--model <id>] [--lan]");
    return;
  }
  const providerName = PROVIDER_NAMES.find((name) => name === values.provider);
  if (!providerName) throw new Error(`--provider must be one of ${PROVIDER_NAMES.join(", ")}.`);
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be a whole number from 1 to 65535.");

  const provider = await createProvider(providerName);
  await mkdir(dirname(LOG_PATH), { recursive: true, mode: 0o700 });
  const lan = values.lan;
  const server = createAnalysisServer({ provider, providerName, model: values.model, lan, log: writeRequestLog });
  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use; pass --port.` : `Could not listen: ${error.message}`);
    process.exitCode = 1;
  });
  // --lan lets a phone on the same network reach the server, so anyone on that
  // network can run analyses on this machine's login. For testing only.
  server.listen(port, lan ? "0.0.0.0" : HOST, () => {
    const address = lan ? lanAddress() : HOST;
    console.log(
      [
        `Developer analysis server on http://${address}:${port} (provider ${providerName}${values.model ? `, model ${values.model}` : ""}).`,
        `In a development build set EXPO_PUBLIC_ANALYSIS_URL=http://${address}:${port}. Production builds ignore it.`,
        lan
          ? "Listening on the local network: anyone on it can request analyses with this machine's login."
          : `Android emulators need: adb reverse tcp:${port} tcp:${port}`,
        `Request log: ${LOG_PATH}`,
      ].join("\n"),
    );
  });
}

/** This machine's private IPv4 address, for the URL a phone should use. */
function lanAddress(): string {
  const candidates = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal && PRIVATE_ORIGIN.test(`http://${entry.address}`))
    .map((entry) => entry.address);
  // 172.16/12 is usually a Docker bridge, which a phone can't reach.
  return candidates.find((address) => !address.startsWith("172.")) ?? candidates[0] ?? "0.0.0.0";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Could not start the analysis server.");
    process.exitCode = 1;
  });
}
