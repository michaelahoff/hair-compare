import { z } from "zod";
import {
  ScalpAnalysisSchema,
  type AssessmentPhoto,
  type AssessmentRequest,
  type ScalpAnalysis,
} from "../../supabase/functions/_shared/analysis";
import { assessmentInputs } from "./assessment-inputs";
import type { Journal, Photo } from "./model";
import { readPhotoBase64 } from "./read-photo";

// Development builds only: production bundles never talk to the dev server.
const configuredUrl = process.env.EXPO_PUBLIC_ANALYSIS_URL?.trim().replace(
  /\/+$/,
  "",
);
export const DEV_ANALYSIS_URL: string | null =
  __DEV__ && configuredUrl ? configuredUrl : null;

const ErrorBody = z.object({ error: z.string() });
const AnalysisResponse = z.object({
  result: ScalpAnalysisSchema,
  model: z.string(),
});

export async function requestDevAnalysis(
  journal: Journal,
  photoId: string,
): Promise<{
  result: ScalpAnalysis;
  model: string;
  previousId: string | null;
}> {
  const url = DEV_ANALYSIS_URL;
  if (!url) throw new Error("The developer analysis server is not configured.");
  const { photo, previous, treatments } = assessmentInputs(journal, photoId);
  const request: AssessmentRequest = {
    photo: await assessmentPhoto(photo),
    previous: previous ? await assessmentPhoto(previous) : null,
    treatments,
  };
  let response: Response;
  try {
    response = await fetch(`${url}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new Error(
      `Couldn't reach the developer analysis server at ${url}. Is it running?`,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = ErrorBody.safeParse(body);
    throw new Error(
      failure.success
        ? failure.data.error
        : `The developer analysis server failed with status ${response.status}.`,
    );
  }
  const parsed = AnalysisResponse.safeParse(body);
  if (!parsed.success)
    throw new Error(
      "The developer analysis server returned an unexpected result.",
    );
  return {
    result: parsed.data.result,
    model: parsed.data.model,
    previousId: previous?.id ?? null,
  };
}

async function assessmentPhoto(photo: Photo): Promise<AssessmentPhoto> {
  return {
    base64: await readPhotoBase64(photo.uri),
    media_type: "image/jpeg",
    view: photo.view,
    taken_at: photo.taken_at,
    hair_length: photo.hair_length,
    hair_wet: photo.hair_wet,
    notes: photo.notes,
  };
}
