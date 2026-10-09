import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import { MIN_MATCH } from "@/lib/alignment";
import {
  GUIDE_SIZE,
  changeConfidence,
  computeChangeMap,
  matchScore,
  type ChangeMap,
} from "@/lib/change-map";
import { framingOf, type Framing } from "@/lib/framing";
import { guideGray } from "@/lib/photos";
import type { Photo } from "@/lib/model";

type Rendered = Awaited<ReturnType<typeof guideGray>>;

/**
 * Guide renders by photo and framing. Each photo of a timeline sits in two
 * neighbouring pairs, so a region's trend reads every photo once.
 */
const renders = new Map<string, Promise<Rendered>>();
const MAX_RENDERS = 12;
function render(photo: Photo, framing: Framing): Promise<Rendered> {
  const key = `${photo.id}:${framing.tx}:${framing.ty}:${framing.rotation}:${framing.scale}`;
  let entry = renders.get(key);
  if (!entry) {
    entry = guideGray(photo, framing, GUIDE_SIZE);
    entry.catch(() => renders.delete(key));
    renders.set(key, entry);
    // Oldest first: drop the least recently added once full.
    if (renders.size > MAX_RENDERS)
      renders.delete(renders.keys().next().value!);
  }
  return entry;
}

/** Let the screen paint before the synchronous pixel work starts. */
function afterPaint() {
  return new Promise<void>((resolve) =>
    typeof requestIdleCallback === "function"
      ? requestIdleCallback(() => resolve(), { timeout: 200 })
      : setTimeout(resolve, 16),
  );
}

export type ChangeData = { map: ChangeMap; match: number };

async function computeChange(before: Photo, after: Photo): Promise<ChangeData> {
  const beforeFraming = framingOf(before);
  const afterFraming = framingOf(after);
  if (!beforeFraming || !afterFraming)
    throw new Error("Line up both photos to see change");
  const [b, a] = await Promise.all([
    render(before, beforeFraming),
    render(after, afterFraming),
  ]);
  await afterPaint();
  const masks = { before: b.mask, after: a.mask };
  return {
    map: computeChangeMap(b.image, a.image, masks),
    match: matchScore(b.image, a.image, masks),
  };
}

const changeKey = (before?: Photo, after?: Photo) =>
  [
    "change-map",
    before?.id ?? null,
    after?.id ?? null,
    before ? framingOf(before) : null,
    after ? framingOf(after) : null,
  ] as const;

/**
 * The texture change map for a pair, cached in memory by both photos and
 * their framings, so lining either photo up again recomputes it. Shared by
 * Compare and the head map's trends.
 */
export function changeMapQuery(
  before: Photo | undefined,
  after: Photo | undefined,
  enabled = true,
) {
  return queryOptions({
    queryKey: changeKey(before, after),
    queryFn:
      enabled && before && after && framingOf(before) && framingOf(after)
        ? () => computeChange(before, after)
        : skipToken,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}

/** A pair's map with its confidence, which depends on capture conditions too. */
export function changeResult(data: ChangeData, before: Photo, after: Photo) {
  return {
    ...data,
    ...changeConfidence({
      coverage: data.map.coverage,
      match: data.match,
      minMatch: MIN_MATCH,
      before,
      after,
    }),
  };
}
export type ChangeResult = ReturnType<typeof changeResult>;

/**
 * Texture change between a lined-up pair, computed off the first paint.
 * `status` is "unframed" when either photo still needs lining up.
 */
export function useChangeMap(
  before: Photo | undefined,
  after: Photo | undefined,
  enabled = true,
): {
  status: "unframed" | "idle" | "loading" | "ready" | "error";
  result: ChangeResult | null;
  error: Error | null;
} {
  const framed = Boolean(
    before && after && framingOf(before) && framingOf(after),
  );
  const query = useQuery(changeMapQuery(before, after, enabled));
  if (!before || !after || !framed)
    return { status: "unframed", result: null, error: null };
  if (query.data)
    return {
      status: "ready",
      result: changeResult(query.data, before, after),
      error: null,
    };
  if (query.error) return { status: "error", result: null, error: query.error };
  return { status: enabled ? "loading" : "idle", result: null, error: null };
}
