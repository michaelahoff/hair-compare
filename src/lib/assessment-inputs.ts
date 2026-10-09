import type { Journal, Photo, Treatment } from "./model";

export type AssessmentInputs = {
  photo: Photo;
  previous: Photo | null;
  treatments: Pick<Treatment, "name" | "dosage" | "started_on" | "ended_on">[];
};

/**
 * Resolve what an assessment of `photoId` is given: the photo, an earlier
 * photo of its view to compare with (`previousId` when given, as Compare does
 * for its chosen pair, else the latest one) and treatments. Mirrors the
 * selection in the analyze-photo edge function so the developer server sees
 * the same inputs.
 */
export function assessmentInputs(
  journal: Journal,
  photoId: string,
  previousId?: string,
): AssessmentInputs {
  const photo = journal.photos.find((p) => p.id === photoId);
  if (!photo) throw new Error("Photo not found.");
  const takenAt = Date.parse(photo.taken_at);
  const earlier = journal.photos.filter(
    (p) => p.view === photo.view && Date.parse(p.taken_at) < takenAt,
  );
  const latestFirst = earlier.sort(
    (a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at),
  );
  const previous = previousId
    ? earlier.find((p) => p.id === previousId)
    : (latestFirst[0] ?? null);
  if (previous === undefined)
    throw new Error("Compare with an earlier photo of the same view.");
  // Treatments are dated by calendar day, as the edge function compares them.
  const day = photo.taken_at.slice(0, 10);
  const treatments = journal.treatments
    .filter((t) => t.started_on <= day)
    .sort((a, b) => a.started_on.localeCompare(b.started_on))
    .map(({ name, dosage, started_on, ended_on }) => ({
      name,
      dosage,
      started_on,
      ended_on,
    }));
  return { photo, previous, treatments };
}
