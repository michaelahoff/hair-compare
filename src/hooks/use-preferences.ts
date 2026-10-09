import { useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "./use-journal";
import { CLOSEUP_VIEWS, guideCarry, type GuideStyle } from "@/lib/guide-art";
import { compose, framingOf } from "@/lib/framing";
import { saveAlignment } from "@/lib/repository";
import type { Journal, ScalpView } from "@/lib/model";

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

/** How a view's guide is shown, and the controls that change it. */
export function useViewGuide(view: ScalpView) {
  const { preferences, update } = usePreferences();
  const { owner } = useAccount();
  const cache = useQueryClient();
  const variant = guideStyleOf(preferences, view);
  /**
   * Show the other picture, carrying every lined-up photo of the view onto it
   * so they stay lined up, with each other and with photos placed later.
   */
  async function setVariant(next: GuideStyle) {
    if (next === variant) return;
    const carry = guideCarry(view, variant, next);
    update((p) => ({ ...p, guides: { ...p.guides, [view]: next } }));
    const key = ["journal", owner];
    const photos = cache.getQueryData<Journal>(key)?.photos ?? [];
    for (const photo of photos) {
      const framing = framingOf(photo);
      if (photo.view !== view || !framing) continue;
      const alignment = { ...framing, ...compose(carry, framing) };
      await saveAlignment(owner, photo.id, alignment);
      cache.setQueryData<Journal>(key, (current) =>
        current && {
          ...current,
          photos: current.photos.map((p) =>
            p.id === photo.id ? { ...p, alignment } : p,
          ),
        },
      );
    }
  }
  return {
    turn: preferences.turns[view] ?? 0,
    variant,
    turnGuide: () =>
      update((p) => ({
        ...p,
        turns: { ...p.turns, [view]: ((p.turns[view] ?? 0) + 1) % 4 },
      })),
    setVariant,
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
