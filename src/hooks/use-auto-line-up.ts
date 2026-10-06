import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "./use-journal";
import { alignPhotos } from "@/lib/photos";
import { saveAlignment } from "@/lib/repository";
import { chainFraming, framingOf } from "@/lib/framing";
import type { Photo } from "@/lib/model";
import type { Similarity } from "@/lib/alignment";

/** Below this edge correlation a registration is more likely wrong than right. */
export const MIN_MATCH = 0.3;

/**
 * Frame `target` from an already-framed `reference` of the same view by
 * matching their details. Null when no trustworthy match is found.
 */
export async function matchFraming(
  reference: Photo,
  referenceFraming: Similarity,
  target: Photo,
): Promise<Similarity | null> {
  const result = await alignPhotos(reference.uri, target.uri).catch(() => null);
  if (!result || result.score < MIN_MATCH) return null;
  return chainFraming(reference, referenceFraming, target, result.transform);
}

/** Line up every unframed photo from the nearest-dated framed one. */
export function useAutoLineUp() {
  const { owner } = useAccount();
  const cache = useQueryClient();
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  async function run(photos: Photo[]) {
    // Prefer hand-placed references: errors would compound through auto ones.
    const framed = photos.filter((p) => framingOf(p));
    const manual = framed.filter((p) => framingOf(p)?.source !== "auto");
    const references = manual.length ? manual : framed;
    const targets = photos.filter((p) => !framingOf(p));
    if (!references.length) return { lined: 0, missed: targets.length };
    let lined = 0;
    setProgress({ done: 0, total: targets.length });
    try {
      for (const [i, target] of targets.entries()) {
        const at = Date.parse(target.taken_at);
        const reference = references.reduce((best, p) =>
          Math.abs(Date.parse(p.taken_at) - at) <
          Math.abs(Date.parse(best.taken_at) - at)
            ? p
            : best,
        );
        const framing = await matchFraming(
          reference,
          framingOf(reference)!,
          target,
        );
        if (framing) {
          await saveAlignment(owner, target.id, { ...framing, source: "auto" });
          lined++;
        }
        setProgress({ done: i + 1, total: targets.length });
      }
    } finally {
      setProgress(null);
      await cache.invalidateQueries({ queryKey: ["journal", owner] });
    }
    return { lined, missed: targets.length - lined };
  }
  return { run, progress };
}
