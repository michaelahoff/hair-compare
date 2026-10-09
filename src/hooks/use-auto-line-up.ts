import { useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { journalKey, useAccount } from "./use-journal";
import { readJournal, saveAlignment } from "@/lib/repository";
import { framingOf, keptAsTaken, type Framing } from "@/lib/framing";
import type { GuideStyle } from "@/lib/guide-art";
import { matchFraming, referenceFor } from "@/lib/match";
import type { Journal, Photo } from "@/lib/model";

/**
 * Where a photo is in automatic line-up. A photo with nothing to match
 * against has no state.
 */
export type LineUpState = "queued" | "matching" | "lined" | "missed";

/** Waiting to be matched, or being matched now. */
export const isLiningUp = (state: LineUpState | undefined) =>
  state === "queued" || state === "matching";

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
  const cached = cache.getQueryData<Journal>(journalKey(owner));
  if (cached?.photos.some((p) => p.id === id)) return cached;
  return cache.fetchQuery({
    queryKey: journalKey(owner),
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
  cache.setQueryData<Journal>(journalKey(owner), (current) =>
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
   * on `variant`, the picture shown, and anchors the other.
   */
  async function pairUp(pair: Photo[], photos: Photo[], variant: GuideStyle) {
    const targets = pair.filter((p) => !framingOf(p) && !states.has(p.id));
    if (!targets.length) return;
    if (!photos.some((p) => framingOf(p))) {
      const [anchor] = targets;
      await store(owner, cache, anchor.id, keptAsTaken(anchor.view, variant));
      targets.shift();
    }
    await lineUp(targets.map((p) => p.id));
  }
  /** Keep a framing found another way, e.g. by Claude, snapping it into place. */
  async function place(id: string, framing: Framing) {
    await store(owner, cache, id, { ...framing, source: "auto" });
    setState(id, "lined");
  }
  return { lineUp, run, pairUp, place, progress };
}
