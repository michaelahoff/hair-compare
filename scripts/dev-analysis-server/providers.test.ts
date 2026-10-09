import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import { ScalpAnalysisSchema } from "../../supabase/functions/_shared/analysis";
import { SYSTEM_PROMPT, assessmentParts, type AssessmentPart } from "../../supabase/functions/_shared/assessment-prompt";
import { buildCodexPrompt } from "./providers/codex";
import type { Provider } from "./providers/types";
import { analyzeBody, createAnalysisServer, isAllowedOrigin, type RequestLog } from "./server";

const validResult = {
  photo_quality: { usable: true, issues: [] },
  norwood_stage: "3",
  confidence: "medium",
  regions: [{ area: "crown", severity: "mild", observation: "Reduced density.", box: null }],
  hair_length_effect: "Short hair makes thinning easier to see.",
  change_since_previous: { assessment: "no_previous", explanation: "No earlier photo." },
  summary: "Density is lower at the crown. This is one photo.",
};

const photo = (base64: string, overrides: Record<string, unknown> = {}) => ({
  base64,
  media_type: "image/jpeg",
  view: "crown",
  taken_at: "2026-10-02T12:00:00.000Z",
  hair_length: "short",
  hair_wet: false,
  notes: "private note",
  ...overrides,
});

const body = {
  photo: photo("CURRENTIMAGE"),
  previous: photo("PREVIOUSIMAGE", { taken_at: "2026-09-02T12:00:00.000Z" }),
  treatments: [{ name: "Secret treatment", dosage: "5%", started_on: "2026-08-01", ended_on: null }],
};

function fakeProvider(result: unknown = validResult, model = "fake-model") {
  const calls: { parts: AssessmentPart[]; model?: string }[] = [];
  const provider: Provider = {
    async analyze(parts, options) {
      calls.push({ parts, model: options.model });
      return { result, model };
    },
  };
  return { provider, calls };
}

describe("codex prompt", () => {
  test("system prompt first, then the text parts in order with image markers in place", () => {
    const parts = assessmentParts(
      { ...photo("CURRENT"), data: "CURRENT" },
      { ...photo("PREVIOUS", { taken_at: "2026-09-02T12:00:00.000Z" }), data: "PREVIOUS" },
      [{ name: "Minoxidil", dosage: null, started_on: "2026-08-01", ended_on: null }],
    );
    const prompt = buildCodexPrompt(parts);
    const at = (text: string) => prompt.indexOf(text);

    expect(prompt.startsWith(`${SYSTEM_PROMPT}\n\nPrevious photo — `)).toBe(true);
    expect(at("[Image 1 attached: the previous photo described above]")).toBeGreaterThan(at("Previous photo — "));
    expect(at("Current photo — ")).toBeGreaterThan(at("[Image 1 attached: the previous photo described above]"));
    expect(at("[Image 2 attached: the current photo described above]")).toBeGreaterThan(at("Current photo — "));
    expect(at("Treatments started on or before the current photo:")).toBeGreaterThan(at("[Image 2 attached"));
    expect(prompt.endsWith("Assess the current photo.")).toBe(true);
    expect(prompt).not.toContain("PREVIOUS");
    expect(prompt).not.toContain("CURRENT");
  });

  test("a lone image is the current photo", () => {
    const parts = assessmentParts({ ...photo("CURRENT"), data: "CURRENT" }, null, []);
    const prompt = buildCodexPrompt(parts);
    expect(prompt).toContain("[Image 1 attached: the current photo described above]");
    expect(prompt).not.toContain("previous photo described above");
    expect(prompt).toContain("No treatments recorded.");
  });
});

describe("origin check", () => {
  test.each(["http://localhost:8081", "http://127.0.0.1:8787", "http://localhost"])("allows %s", (origin) => {
    expect(isAllowedOrigin(origin)).toBe(true);
  });

  test.each([
    "https://evil.example",
    "http://localhost.evil.example:8081",
    "http://127.0.0.1.evil.example",
    "https://localhost:8081",
    "http://192.168.1.20:8081",
    "null",
  ])("refuses %s", (origin) => {
    expect(isAllowedOrigin(origin)).toBe(false);
  });
});

describe("request validation", () => {
  test("rejects a body that is not JSON", async () => {
    const { provider, calls } = fakeProvider();
    const outcome = await analyzeBody("{nope", provider, undefined);
    expect(outcome.status).toBe(400);
    expect(outcome.log.status).toBe("error");
    expect(calls).toHaveLength(0);
  });

  test("rejects a body that fails AssessmentRequestSchema, naming the path only", async () => {
    const { provider, calls } = fakeProvider();
    const outcome = await analyzeBody(JSON.stringify({ photo: { ...body.photo, view: "back" }, previous: null, treatments: [] }), provider, undefined);
    expect(outcome.status).toBe(400);
    expect(String((outcome.body as { error: string }).error)).toContain("photo.view");
    expect(JSON.stringify(outcome.body)).not.toContain("back");
    expect(calls).toHaveLength(0);
  });

  test("sends the shared parts to the provider and returns the validated result", async () => {
    const { provider, calls } = fakeProvider();
    const outcome = await analyzeBody(JSON.stringify(body), provider, "some-model");
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ result: ScalpAnalysisSchema.parse(validResult), model: "fake-model" });
    expect(calls[0].model).toBe("some-model");
    expect(calls[0].parts).toEqual(
      assessmentParts(
        { ...body.photo, data: "CURRENTIMAGE" },
        { ...body.previous, data: "PREVIOUSIMAGE" },
        body.treatments,
      ),
    );
  });

  test("a result that fails ScalpAnalysisSchema is a 502 invalid_schema", async () => {
    const { provider } = fakeProvider({ summary: "missing most fields" });
    const outcome = await analyzeBody(JSON.stringify(body), provider, undefined);
    expect(outcome.status).toBe(502);
    expect(outcome.log.status).toBe("invalid_schema");
  });

  test("a provider exception is a 502 error with its message", async () => {
    const provider: Provider = { analyze: async () => { throw new Error("codex exited with 1"); } };
    const outcome = await analyzeBody(JSON.stringify(body), provider, undefined);
    expect(outcome.status).toBe(502);
    expect(outcome.log).toEqual({ status: "error", model: null, error: "Provider failed: Error: codex exited with 1" });
  });
});

describe("HTTP server", () => {
  let server: Server;
  let base: string;
  let logs: RequestLog[];
  let calls: { parts: AssessmentPart[]; model?: string }[];

  beforeAll(async () => {
    logs = [];
    const fake = fakeProvider();
    calls = fake.calls;
    server = createAnalysisServer({ provider: fake.provider, providerName: "claude", log: (entry) => { logs.push(entry); } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => {
    server.close();
  });

  test("health reports the provider", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, provider: "claude", model: null });
  });

  test("preflight from Expo web is allowed and echoes the origin", async () => {
    const res = await fetch(`${base}/analyze`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:8081", "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:8081");
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  test("preflight from another site gets no CORS grant", async () => {
    const res = await fetch(`${base}/analyze`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("a cross-site POST is refused before it reaches the provider", async () => {
    const before = calls.length;
    const res = await fetch(`${base}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Origin: "https://evil.example" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(403);
    expect(calls.length).toBe(before);
  });

  test("a native request with no Origin is analysed", async () => {
    const res = await fetch(`${base}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { model: string }).model).toBe("fake-model");
  });

  test("a malformed POST is a 400 and its log line holds no images, notes or treatment names", async () => {
    logs.length = 0;
    const res = await fetch(`${base}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{\"photo\": ",
    });
    expect(res.status).toBe(400);
    expect(logs).toEqual([{ provider: "claude", model: null, latencyMs: expect.any(Number), status: "error", error: "Request body must be JSON." }]);
    expect(JSON.stringify(logs)).not.toContain("private note");
  });

  test("a body over 25 MB is a 413", async () => {
    const res = await fetch(`${base}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: new Uint8Array(25 * 1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
  });

  test("other routes are 404", async () => {
    expect((await fetch(`${base}/analyze`)).status).toBe(404);
    expect((await fetch(`${base}/nothing`)).status).toBe(404);
  });
});
