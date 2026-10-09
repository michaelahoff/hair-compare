import { useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAccount } from "./use-journal";
import { alignPhotos } from "@/lib/photos";
import { requestDevMatch } from "@/lib/dev-analysis";
import { robustSimilarity } from "@/lib/alignment/points";
import { readJournal, saveAlignment } from "@/lib/repository";
import {
  IDENTITY,
  chainFraming,
  framingOf,
  type Framing,
} from "@/lib/framing";
import type { Journal, Photo } from "@/lib/model";
import { MIN_MATCH, type Similarity } from "@/lib/alignment";

/**
 * Frame `target` from an already-framed `reference` of the same view by
 * matching their details. Null when no trustworthy match is found; throws
 * when the photos can't be read.
 */
export async function matchFraming(
  reference: Photo,
  referenceFraming: Similarity,
  target: Photo,
): Promise<Similarity | null> {
  const result = await alignPhotos(reference.uri, target.uri);
  if (result.score < MIN_MATCH) return null;
  return chainFraming(reference, referenceFraming, target, result.transform);
}

/** Pairs must agree to within this share of the photo's width. */
const POINT_TOLERANCE = 0.05;
/** Fewest agreeing pairs, and their largest typical miss, to trust a fit. */
const MIN_POINTS = 3;
const MAX_POINT_MISS = 0.03;
/** How far the fitted turn may stray from the turn the model reported. */
const MAX_TURN_DISAGREEMENT = (30 * Math.PI) / 180;

/**
 * Frame `target` from `reference` using the spots the developer server's
 * model finds in both. Null when it finds too few, or they don't agree.
 */
export async function matchWithClaude(
  reference: Photo,
  referenceFraming: Similarity,
  target: Photo,
): Promise<Similarity | null> {
  const { result, sizes } = await requestDevMatch(reference, target);
  if (!result.same_area) return null;
  // Into each photo's own normalised coordinates (see alignment/transform).
  const normal = (p: { x: number; y: number }, size: typeof sizes.a) =>
    [
      (p.x - (size.width - 1) / 2) / size.width,
      (p.y - (size.height - 1) / 2) / size.width,
    ] as [number, number];
  const fit = robustSimilarity(
    result.points.map((p) => ({
      a: normal(p.a, sizes.a),
      b: normal(p.b, sizes.b),
    })),
    POINT_TOLERANCE,
  );
  if (!fit || fit.inliers < MIN_POINTS || fit.rms > MAX_POINT_MISS) return null;
  const said = (result.rotation_deg * Math.PI) / 180;
  const turn = Math.atan2(
    Math.sin(fit.transform.rotation - said),
    Math.cos(fit.transform.rotation - said),
  );
  if (Math.abs(turn) > MAX_TURN_DISAGREEMENT) return null;
  return chainFraming(reference, referenceFraming, target, fit.transform);
}

/**
 * The photo to line `photo` up from: the nearest-dated photo of its view
 * placed by hand, else the nearest-dated matched one. Errors would compound
 * through matched ones, so hand-placed photos come first.
 */
export function referenceFor(photo: Photo, photos: Photo[]) {
  const framed = photos.filter(
    (p) => p.id !== photo.id && p.view === photo.view && framingOf(p),
  );
  const manual = framed.filter((p) => framingOf(p)?.source !== "auto");
  const at = Date.parse(photo.taken_at);
  const distance = (p: Photo) => Math.abs(Date.parse(p.taken_at) - at);
  return (manual.length ? manual : framed).reduce<Photo | undefined>(
    (best, p) => (!best || distance(p) < distance(best) ? p : best),
    undefined,
  );
}

/**
 * Where a photo is in automatic line-up. A photo with nothing to match
 * against has no state.
 */
export type LineUpState = "queued" | "matching" | "lined" | "missed";

// One queue for the whole app: matching is CPU-bound, and a line-up started
// on one screen carries on after it closes.
const states = new Map<string, LineUpState>();
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();

function setState(id: string, state: LineUpState | undefined) {
  if (state) states.set(id, state);
  else states.delete(id);
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A photo's automatic line-up, as it happens. */
export function useLineUpState(id: string) {
  return useSyncExternalStore(subscribe, () => states.get(id));
}

async function journalWith(owner: string, cache: QueryClient, id: string) {
  const cached = cache.getQueryData<Journal>(["journal", owner]);
  if (cached?.photos.some((p) => p.id === id)) return cached;
  return cache.fetchQuery({
    queryKey: ["journal", owner],
    queryFn: () => readJournal(owner),
  });
}

/**
 * Save a photo's framing and patch the cached journal rather than refetching
 * it, so every view of the photo snaps into place without reloading its image.
 */
async function store(
  owner: string,
  cache: QueryClient,
  id: string,
  alignment: Framing,
) {
  await saveAlignment(owner, id, alignment);
  cache.setQueryData<Journal>(["journal", owner], (current) =>
    current
      ? {
          ...current,
          photos: current.photos.map((p) =>
            p.id === id ? { ...p, alignment } : p,
          ),
        }
      : current,
  );
}

/** Queue one photo; resolves true once it is lined up. */
function enqueue(owner: string, cache: QueryClient, id: string) {
  setState(id, "queued");
  const job = queue.then(async () => {
    setState(id, "matching");
    try {
      const journal = await journalWith(owner, cache, id);
      const photo = journal.photos.find((p) => p.id === id);
      const reference = photo && referenceFor(photo, journal.photos);
      // Gone, lined up by hand meanwhile, or nothing to match against.
      if (!photo || framingOf(photo) || !reference) {
        setState(id, undefined);
        return Boolean(photo && framingOf(photo));
      }
      const framing = await matchFraming(
        reference,
        framingOf(reference)!,
        photo,
      );
      if (!framing) {
        setState(id, "missed");
        return false;
      }
      await store(owner, cache, id, { ...framing, source: "auto" });
      setState(id, "lined");
      return true;
    } catch {
      setState(id, "missed");
      return false;
    }
  });
  queue = job;
  return job;
}

/** Line photos up from the ones already lined up, one after another. */
export function useAutoLineUp() {
  const { owner } = useAccount();
  const cache = useQueryClient();
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  /** Line up these photos in the background, e.g. just after they're added. */
  async function lineUp(ids: string[], onDone?: (done: number) => void) {
    let lined = 0;
    let done = 0;
    await Promise.all(
      ids.map(async (id) => {
        if (await enqueue(owner, cache, id)) lined++;
        onDone?.(++done);
      }),
    );
    return { lined, missed: ids.length - lined };
  }
  /** Line up every unframed photo among `photos`, showing progress. */
  async function run(photos: Photo[]) {
    const targets = photos.filter((p) => !framingOf(p)).map((p) => p.id);
    setProgress({ done: 0, total: targets.length });
    try {
      return await lineUp(targets, (done) =>
        setProgress({ done, total: targets.length }),
      );
    } finally {
      setProgress(null);
    }
  }
  /**
   * Line up a compared pair. Each unframed photo is matched to the view's
   * lined-up photos; when the view has none, the first photo stays as it is
   * and anchors the other.
   */
  async function pairUp(pair: Photo[], photos: Photo[]) {
    const targets = pair.filter((p) => !framingOf(p) && !states.has(p.id));
    if (!targets.length) return;
    if (!photos.some((p) => framingOf(p))) {
      const [anchor] = targets;
      await store(owner, cache, anchor.id, { ...IDENTITY, source: "auto" });
      targets.shift();
    }
    await lineUp(targets.map((p) => p.id));
  }
  /** Keep a framing found another way, e.g. by Claude, snapping it into place. */
  async function place(id: string, framing: Similarity) {
    await store(owner, cache, id, { ...framing, source: "auto" });
    setState(id, "lined");
  }
  return { lineUp, run, pairUp, place, progress };
}
