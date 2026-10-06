import type {
  HairLength,
  ScalpAnalysis,
  ScalpView,
} from "../../supabase/functions/_shared/analysis";
import type { Framing } from "./framing";

export type { HairLength, ScalpAnalysis, ScalpView };
export {
  HAIR_LENGTHS,
  SCALP_VIEWS,
  ScalpAnalysisSchema,
} from "../../supabase/functions/_shared/analysis";
export const VIEW_LABELS: Record<ScalpView, string> = {
  top: "Top",
  crown: "Crown",
  hairline: "Hairline",
  left_temple: "Left temple",
  right_temple: "Right temple",
};
export const KIND_LABELS = {
  oral: "Oral",
  topical: "Topical",
  procedure: "Procedure",
  supplement: "Supplement",
  other: "Other",
};
export type Photo = {
  id: string;
  user_id: string;
  view: ScalpView;
  taken_at: string;
  storage_path: string;
  width: number;
  height: number;
  hair_length: HairLength | null;
  hair_wet: boolean;
  notes: string | null;
  /** Placement on the view's guide; read it with `framingOf`. */
  alignment: Framing | null;
  created_at: string;
  uri: string;
};
export type Analysis = {
  id: string;
  user_id: string;
  photo_id: string;
  previous_photo_id: string | null;
  model: string;
  result: ScalpAnalysis;
  created_at: string;
};
export type Treatment = {
  id: string;
  user_id: string;
  name: string;
  kind: keyof typeof KIND_LABELS;
  dosage: string | null;
  started_on: string;
  ended_on: string | null;
  notes: string | null;
  created_at: string;
};
export type Journal = {
  photos: Photo[];
  treatments: Treatment[];
  analyses: Analysis[];
};
export type PhotoInput = Pick<
  Photo,
  "view" | "taken_at" | "hair_length" | "hair_wet" | "notes"
> & { uri: string; width: number; height: number };
export type TreatmentInput = Pick<
  Treatment,
  "name" | "kind" | "dosage" | "started_on" | "ended_on" | "notes"
>;

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDate(date) === value;
}
export function formatDate(value: string): string {
  // A chosen photo date is a calendar day, so preserve it across time zones.
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(
    undefined,
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  );
}
/** "Top · Short · Dry" */
export function photoMeta(photo: Photo, withView = true): string {
  return [
    withView && VIEW_LABELS[photo.view],
    photo.hair_length &&
      photo.hair_length.charAt(0).toUpperCase() + photo.hair_length.slice(1),
    photo.hair_wet ? "Wet" : "Dry",
  ]
    .filter(Boolean)
    .join(" · ");
}
export function photoTimestamp(date: string): string {
  if (!validDate(date)) throw new Error("Enter a valid photo date.");
  return `${date}T12:00:00.000Z`;
}

/** Pick distinct chronological photos, even after a selected photo is deleted. */
export function selectPhotoPair<T extends { id: string }>(
  ordered: readonly T[],
  earlierId: string | null,
  laterId: string | null,
  preferredLaterId?: string,
) {
  let laterIndex = ordered.findIndex((p) => p.id === laterId);
  if (laterIndex <= 0)
    laterIndex = ordered.findIndex((p) => p.id === preferredLaterId);
  if (laterIndex <= 0) laterIndex = ordered.length - 1;
  const earlierIndex = ordered.findIndex((p) => p.id === earlierId);
  return {
    before:
      ordered[
        earlierIndex >= 0 && earlierIndex < laterIndex ? earlierIndex : 0
      ],
    after: ordered[laterIndex],
  };
}
/**
 * Move one side of a before/after pair to `index` in a timeline of `count`
 * photos, pushing the other side along so before stays the earlier photo.
 */
export function movePair(
  count: number,
  pair: { before: number; after: number },
  side: "before" | "after",
  index: number,
) {
  if (side === "before") {
    const before = Math.max(0, Math.min(count - 2, index));
    return { before, after: Math.max(pair.after, before + 1) };
  }
  const after = Math.max(1, Math.min(count - 1, index));
  return { before: Math.min(pair.before, after - 1), after };
}
export function elapsedDays(start: string, end = localDate()): number {
  const a = Date.parse(`${start.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${end.slice(0, 10)}T12:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
}
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "Something went wrong. Please try again.";
}
