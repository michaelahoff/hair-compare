import { useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CLOSEUP_VIEWS, type GuideStyle } from "@/lib/guide-art";
import type { ScalpView } from "@/lib/model";

/** On-device choices that shape how photos are shown, kept across launches. */
export type Preferences = {
  /** The before/after pair last chosen for each view. */
  pairs: Partial<Record<ScalpView, { before: string; after: string }>>;
  /** The view last compared, which the home screen features. */
  lastView?: ScalpView;
  /** Quarter turns clockwise for each view's guide and its photos. */
  turns: Partial<Record<ScalpView, number>>;
  /** Whether each view's photos line up against a whole head or a close-up of the whorl. */
  guides?: Partial<Record<ScalpView, GuideStyle>>;
};

/** The guide picture a view's photos line up against. */
export function guideStyleOf(preferences: Preferences, view: ScalpView) {
  return CLOSEUP_VIEWS.includes(view)
    ? (preferences.guides?.[view] ?? "head")
    : "head";
}

const KEY = "hair-compare:preferences:v1";
const DEFAULTS: Preferences = { pairs: {}, turns: {} };

async function read(): Promise<Preferences> {
  const value = await AsyncStorage.getItem(KEY);
  return value ? { ...DEFAULTS, ...JSON.parse(value) } : DEFAULTS;
}

/**
 * How a view's guide is shown, and the controls that change it. Switching
 * pictures only changes what is shown: each framing records the picture it
 * was placed on and is read on whichever one shows.
 */
export function useViewGuide(view: ScalpView) {
  const { preferences, update } = usePreferences();
  return {
    turn: preferences.turns[view] ?? 0,
    variant: guideStyleOf(preferences, view),
    turnGuide: () =>
      update((p) => ({
        ...p,
        turns: { ...p.turns, [view]: ((p.turns[view] ?? 0) + 1) % 4 },
      })),
    setVariant: (next: GuideStyle) =>
      update((p) => ({ ...p, guides: { ...p.guides, [view]: next } })),
  };
}

export function usePreferences() {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["preferences"],
    queryFn: read,
    staleTime: Infinity,
  });
  const update = useCallback(
    (change: (current: Preferences) => Preferences) => {
      const next = change(
        cache.getQueryData<Preferences>(["preferences"]) ?? DEFAULTS,
      );
      cache.setQueryData(["preferences"], next);
      void AsyncStorage.setItem(KEY, JSON.stringify(next));
    },
    [cache],
  );
  return {
    preferences: query.data ?? DEFAULTS,
    ready: query.isSuccess,
    update,
  };
}
