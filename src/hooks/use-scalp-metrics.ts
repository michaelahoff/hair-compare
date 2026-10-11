import AsyncStorage from "@react-native-async-storage/async-storage";
import { queryOptions, skipToken, useQueries, useQuery } from "@tanstack/react-query";
import { readRgbPhoto } from "@/lib/photos";
import {
  METRICS_VERSION,
  computeScalpMetricsAsync,
  linesReliable,
  type ScalpMetrics,
} from "@/lib/scalp/metrics";
import { breathe, oneAtATime } from "@/lib/steps";
import type { Photo } from "@/lib/model";

/** Width a photo is read at for its metrics: single hairs on a buzzed head still show. */
export const METRICS_WIDTH = 900;
const STORE_KEY = "hair-compare:scalp-metrics:v2";
/** The first version's blob, never read again. */
const OLD_STORE_KEY = "hair-compare:scalp-metrics:v1";

type Stored = Record<string, ScalpMetrics>;
let stored: Promise<Stored> | null = null;
/** Finished this run, before their write lands. */
const fresh = new Map<string, ScalpMetrics>();
let writes: Promise<unknown> = Promise.resolve();

function load(): Promise<Stored> {
  if (!stored) {
    stored = AsyncStorage.getItem(STORE_KEY)
      .then((value) => (value ? (JSON.parse(value) as Stored) : {}))
      .catch(() => ({}));
    AsyncStorage.removeItem(OLD_STORE_KEY).catch(() => {});
  }
  return stored;
}
async function kept(key: string): Promise<ScalpMetrics | undefined> {
  return fresh.get(key) ?? (await load())[key];
}
function remember(key: string, metrics: ScalpMetrics) {
  fresh.set(key, metrics);
  writes = writes
    .then(async () => {
      const all = await load();
      // Entries from older versions are never read again.
      for (const k of Object.keys(all))
        if (!k.endsWith(`:${METRICS_VERSION}`)) delete all[k];
      all[key] = metrics;
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(all));
    })
    .catch(() => {});
}

/**
 * Metrics are kept per photo and version. Hair length only decides whether
 * the line counts are shown, so changing it doesn't redo the pixel work.
 */
const keyOf = (photo: Photo) => `${photo.id}:${METRICS_VERSION}`;

/** The kept figures, read against the photo's current hair length. */
function forPhoto(metrics: ScalpMetrics, photo: Photo): ScalpMetrics {
  return {
    ...metrics,
    hairLength: photo.hair_length,
    linesReliable: linesReliable(photo.hair_length),
  };
}

async function metricsOf(photo: Photo, signal: AbortSignal): Promise<ScalpMetrics> {
  const key = keyOf(photo);
  const known = await kept(key);
  if (known) return forPhoto(known, photo);
  // One photo at a time, pausing between stages: a timeline asks for every
  // photo at once, and each is seconds of work on the JS thread.
  return oneAtATime(async () => {
    // Nobody is looking any more (the screen closed): skip the work.
    if (signal.aborted) throw new Error("Cancelled");
    // Another query for this photo (its hair length was edited while this
    // one waited) may have done the work meanwhile.
    const meanwhile = await kept(key);
    if (meanwhile) return forPhoto(meanwhile, photo);
    const rgb = await readRgbPhoto(photo, METRICS_WIDTH);
    await breathe();
    if (signal.aborted) throw new Error("Cancelled");
    const { metrics } = await computeScalpMetricsAsync(rgb, photo.hair_length);
    remember(key, metrics);
    return forPhoto(metrics, photo);
  });
}

export function scalpMetricsQuery(photo: Photo | undefined, enabled = true) {
  return queryOptions({
    queryKey: [
      "scalp-metrics",
      photo?.id ?? null,
      photo?.hair_length ?? "",
      METRICS_VERSION,
    ] as const,
    queryFn:
      enabled && photo ? ({ signal }) => metricsOf(photo, signal) : skipToken,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
}

/** A photo's scalp metrics, computed once on the device and kept. */
export function useScalpMetrics(photo: Photo | undefined, enabled = true) {
  return useQuery(scalpMetricsQuery(photo, enabled));
}

/** Metrics for a whole timeline, in order; undefined where not ready. */
export function useTimelineMetrics(photos: Photo[], enabled = true) {
  const results = useQueries({
    queries: photos.map((p) => scalpMetricsQuery(p, enabled)),
  });
  return photos.map((photo, i) => ({
    photo,
    metrics: results[i].data,
    error: results[i].error,
    loading: results[i].isPending && enabled,
  }));
}
