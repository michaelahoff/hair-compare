/** PROTOTYPE ONLY. Bits every variant of the Photos home needs. */
import { Platform } from "react-native";
import { SCALP_VIEWS, elapsedDays, type Photo, type ScalpView } from "@/lib/model";

export const FONT = {
  serif: Platform.select({
    ios: "ui-serif",
    android: "serif",
    default: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  }),
  mono: Platform.select({
    ios: "ui-monospace",
    android: "monospace",
    default: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  }),
};

export const VIEWS = SCALP_VIEWS as readonly ScalpView[];

export function byDateDesc(photos: readonly Photo[]) {
  return [...photos].sort(
    (a, b) =>
      b.taken_at.localeCompare(a.taken_at) ||
      b.created_at.localeCompare(a.created_at),
  );
}
export function latestOf(photos: readonly Photo[], view: ScalpView) {
  return byDateDesc(photos.filter((p) => p.view === view))[0];
}
/** "today", "yesterday", "17 days ago", "3 months ago" */
export function ago(date: string) {
  const days = elapsedDays(date);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}
export function shortDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric" },
  );
}
export function monthYear(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric" },
  );
}
