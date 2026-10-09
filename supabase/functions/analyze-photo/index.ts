// Assess one scalp photo with Claude vision and store the result in `analyses`.
//
// POST { "photoId": "<uuid>", "previousId"?: "<uuid>" } with the user's Supabase
// session as the bearer token. `previousId` picks the earlier photo of the same
// view to compare with (Compare's chosen pair); without it, the latest earlier
// one. Runs under the caller's RLS, so users can only analyse their own photos.
// Secrets: ANTHROPIC_API_KEY (set with `supabase secrets set`).

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { encodeBase64 } from "@std/encoding";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { ScalpAnalysisSchema, withOutlineBoxes } from "../_shared/analysis.ts";
import {
  assessmentParts,
  type AssessmentPart,
  SYSTEM_PROMPT,
} from "../_shared/assessment-prompt.ts";

const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";
const BUCKET = "scalp-photos";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


type PhotoRow = {
  id: string;
  view: string;
  taken_at: string;
  storage_path: string;
  hair_length: string | null;
  hair_wet: boolean;
  notes: string | null;
};

const PHOTO_COLUMNS =
  "id, view, taken_at, storage_path, hair_length, hair_wet, notes";

Deno.serve(async (req) => {
  try {
    return await handleRequest(req);
  } catch (error) {
    console.error(
      "Assessment request failed",
      error instanceof Error ? error.name : "unknown",
    );
    return json(
      { error: "Assessment could not be completed. Try again later." },
      502,
    );
  }
});

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization)
    return json({ error: "Missing Authorization header" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!url || !anonKey || !apiKey)
    return json(
      { error: "The assessment service is not configured yet." },
      503,
    );

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return json({ error: "Not signed in" }, 401);

  const body: unknown = await req.json().catch(() => null);
  const field = (name: string) =>
    body && typeof body === "object" && name in body
      ? (body as Record<string, unknown>)[name]
      : undefined;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const photoId = field("photoId");
  if (typeof photoId !== "string" || !uuid.test(photoId))
    return json({ error: "A valid photoId is required" }, 400);
  const previousId = field("previousId");
  if (
    previousId !== undefined &&
    previousId !== null &&
    (typeof previousId !== "string" || !uuid.test(previousId))
  )
    return json({ error: "previousId must be a photo id" }, 400);

  const { data: photo, error: photoError } = await supabase
    .from("photos")
    .select(PHOTO_COLUMNS)
    .eq("id", photoId)
    .eq("user_id", auth.user.id)
    .maybeSingle<PhotoRow>();
  if (photoError) return json({ error: photoError.message }, 500);
  if (!photo) return json({ error: "Photo not found" }, 404);

  let earlier = supabase
    .from("photos")
    .select(PHOTO_COLUMNS)
    .eq("view", photo.view)
    .eq("user_id", auth.user.id);
  // A chosen photo may share the day: photos are dated by day, at noon.
  earlier =
    typeof previousId === "string"
      ? earlier
          .eq("id", previousId)
          .neq("id", photo.id)
          .lte("taken_at", photo.taken_at)
      : earlier.lt("taken_at", photo.taken_at);
  const { data: previous, error: previousError } = await earlier
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle<PhotoRow>();
  if (previousError)
    return json(
      { error: "Earlier photos could not be loaded. Try again." },
      500,
    );
  if (typeof previousId === "string" && !previous)
    return json(
      { error: "Compare with an earlier photo of the same view." },
      400,
    );

  const { data: treatments, error: treatmentsError } = await supabase
    .from("treatments")
    .select("name, dosage, started_on, ended_on")
    .eq("user_id", auth.user.id)
    .lte("started_on", photo.taken_at.slice(0, 10))
    .order("started_on");
  if (treatmentsError)
    return json(
      { error: "Treatment history could not be loaded. Try again." },
      500,
    );

  // Previous image first, as the shared prompt builder expects its parts in order.
  const previousPhoto =
    previous && { ...previous, data: await loadImage(supabase, previous.storage_path) };
  const currentPhoto = { ...photo, data: await loadImage(supabase, photo.storage_path) };
  const content = assessmentParts(currentPhoto, previousPhoto, treatments ?? []).map(
    toContentBlock,
  );

  const anthropic = new Anthropic({ apiKey, timeout: 90000, maxRetries: 0 });
  let response;
  try {
    response = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(ScalpAnalysisSchema) },
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return json(
        { error: "The analysis service is busy. Try again in a minute." },
        503,
      );
    }
    if (error instanceof Anthropic.APIError) {
      console.error("Anthropic API error", error.status, error.message);
      return json({ error: "Analysis failed. Try again later." }, 502);
    }
    throw error;
  }

  if (response.stop_reason === "refusal") {
    return json({ error: "The model declined to analyse this photo." }, 422);
  }
  if (!response.parsed_output) {
    console.error("Unparseable analysis", response.stop_reason);
    return json(
      { error: "Analysis returned an unexpected format. Try again." },
      502,
    );
  }

  const { data: analysis, error: insertError } = await supabase
    .from("analyses")
    .insert({
      photo_id: photo.id,
      user_id: auth.user.id,
      previous_photo_id: previous?.id ?? null,
      model: response.model,
      // Boxes follow the outline, so clients that only draw boxes keep working.
      result: withOutlineBoxes(response.parsed_output),
    })
    .select()
    .single();
  if (insertError) return json({ error: insertError.message }, 500);

  return json(analysis, 200);
}

function toContentBlock(part: AssessmentPart): Anthropic.ContentBlockParam {
  return part.type === "text"
    ? { type: "text", text: part.text }
    : {
        type: "image",
        source: { type: "base64", media_type: part.media_type, data: part.data },
      };
}

async function loadImage(supabase: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data)
    throw new Error(`Could not read ${path}: ${error?.message}`);
  return encodeBase64(await data.arrayBuffer());
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
