import AsyncStorage from "@react-native-async-storage/async-storage";
import { queryOptions, skipToken, useQueries, useQuery } from "@tanstack/react-query";
import { readRgbPhoto } from "@/lib/photos";
import {
  METRICS_VERSION,
  computeScalpMetrics,
  type ScalpMetrics,
} from "@/lib/scalp/metrics";
import type { Photo } from "@/lib/model";

/** Width a photo is read at for its metrics: single hairs on a buzzed head still show. */
export const METRICS_WIDTH = 900;
const STORE_KEY = "hair-compare:scalp-metrics:v1";

type Stored = Record<string, ScalpMetrics>;
let stored: Promise<Stored> | null = null;
let writes: Promise<unknown> = Promise.resolve();

function load(): Promise<Stored> {
  if (!stored)
    stored = AsyncStorage.getItem(STORE_KEY)
      .then((value) => (value ? (JSON.parse(value) as Stored) : {}))
      .catch(() => ({}));
  return stored;
}
function remember(key: string, metrics: ScalpMetrics) {
  writes = writes
    .catch(() => {})
    .then(async () => {
      const all = await load();
      all[key] = metrics;
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(all));
    });
}

/** Metrics are per photo file and hair length; a new file is a new key. */
const keyOf = (photo: Photo) =>
  `${photo.id}:${photo.hair_length ?? ""}:${METRICS_VERSION}`;

/** Let the screen paint before the pixel work starts. */
function afterPaint() {
  return new Promise<void>((resolve) =>
    typeof requestIdleCallback === "function"
      ? requestIdleCallback(() => resolve(), { timeout: 200 })
      : setTimeout(resolve, 16),
  );
}

async function metricsOf(photo: Photo): Promise<ScalpMetrics> {
  const key = keyOf(photo);
  const cached = (await load())[key];
  if (cached) return cached;
  const rgb = await readRgbPhoto(photo, METRICS_WIDTH);
  await afterPaint();
  const { metrics } = computeScalpMetrics(rgb, photo.hair_length);
  remember(key, metrics);
  return metrics;
}

export function scalpMetricsQuery(photo: Photo | undefined, enabled = true) {
  return queryOptions({
    queryKey: ["scalp-metrics", photo ? keyOf(photo) : null] as const,
    queryFn: enabled && photo ? () => metricsOf(photo) : skipToken,
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
