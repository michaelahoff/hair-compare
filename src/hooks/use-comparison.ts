import { usePreferences } from "./use-preferences";
import {
  movePair,
  selectPhotoPair,
  type Photo,
  type ScalpView,
} from "@/lib/model";

/** A view's photos, oldest first. */
export function timelineOf(photos: readonly Photo[], view: ScalpView) {
  return photos
    .filter((p) => p.view === view)
    .sort(
      (a, b) =>
        a.taken_at.localeCompare(b.taken_at) ||
        a.created_at.localeCompare(b.created_at),
    );
}

/**
 * The before/after pair chosen for each view, shared by every screen that
 * shows one and remembered across launches. Unchosen, a view compares its
 * first and latest photos.
 */
export function useComparison(photos: readonly Photo[]) {
  const { preferences, ready, update } = usePreferences();
  const latest = photos.reduce<Photo | undefined>(
    (best, p) => (!best || p.taken_at > best.taken_at ? p : best),
    undefined,
  );
  const view = preferences.lastView ?? latest?.view ?? "top";
  function pairOf(of: ScalpView) {
    const ordered = timelineOf(photos, of);
    const stored = preferences.pairs[of];
    return {
      ordered,
      ...selectPhotoPair(
        ordered,
        stored?.before ?? null,
        stored?.after ?? null,
      ),
    };
  }
  function choose(of: ScalpView, before: string, after: string) {
    update((p) => ({
      ...p,
      lastView: of,
      pairs: { ...p.pairs, [of]: { before, after } },
    }));
  }
  function setView(of: ScalpView) {
    update((p) => ({ ...p, lastView: of }));
  }
  /** Bring `photo` into its view's pair, keeping the other side if it still fits. */
  function focus(photo: Photo) {
    const { ordered, before, after } = pairOf(photo.view);
    const index = ordered.findIndex((p) => p.id === photo.id);
    if (ordered.length < 2 || !before || !after || index < 0)
      return setView(photo.view);
    const next = movePair(
      ordered.length,
      { before: ordered.indexOf(before), after: ordered.indexOf(after) },
      index === 0 ? "before" : "after",
      index,
    );
    choose(photo.view, ordered[next.before].id, ordered[next.after].id);
  }
  return {
    ready,
    view,
    turns: preferences.turns,
    pairOf,
    choose,
    setView,
    focus,
  };
}
